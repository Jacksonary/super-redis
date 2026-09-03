use redis::Value;
use std::sync::Arc;

use crate::redisclient::{self, Session};
use crate::types::KeyInfo;

/// Flatten a `redis::Value` into a display string.
///
/// `redis::Value` (1.x) implements neither `Display` nor `ToString`, so every
/// variant used for display must be matched explicitly; anything else falls back
/// to the debug form.
pub fn val_to_string(v: &Value) -> String {
    match v {
        Value::Nil => String::new(),
        Value::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        Value::Int(i) => i.to_string(),
        Value::Double(d) => d.to_string(),
        Value::SimpleString(s) => s.clone(),
        Value::Okay => "OK".to_string(),
        Value::Array(l) => l.iter().map(val_to_string).collect::<Vec<_>>().join(", "),
        Value::Set(l) => l.iter().map(val_to_string).collect::<Vec<_>>().join(", "),
        Value::Map(m) => m
            .iter()
            .map(|(a, b)| format!("{}: {}", val_to_string(a), val_to_string(b)))
            .collect::<Vec<_>>()
            .join(", "),
        Value::Boolean(b) => b.to_string(),
        Value::VerbatimString { text, .. } => text.clone(),
        Value::Push { data, .. } => data.iter().map(val_to_string).collect::<Vec<_>>().join(", "),
        Value::Attribute { data, .. } => val_to_string(data),
        Value::ServerError(e) => format!("ERR: {e:?}"),
        unk => format!("{unk:?}"),
    }
}

/// Interpret a `redis::Value` as a 64-bit integer, defaulting to 0.
pub fn val_to_i64(v: &Value) -> i64 {
    match v {
        Value::Int(i) => *i,
        Value::BulkString(b) => String::from_utf8_lossy(b).parse().unwrap_or(0),
        Value::SimpleString(s) => s.parse().unwrap_or(0),
        Value::Double(d) => *d as i64,
        _ => 0,
    }
}

/// Parse the `[cursor, keys[]]` array returned by SCAN / HSCAN / SSCAN / ZSCAN.
pub fn parse_scan(v: &Value) -> (u64, Vec<String>) {
    match v {
        Value::Array(arr) if arr.len() >= 2 => {
            let cursor = val_to_string(&arr[0]).parse::<u64>().unwrap_or(0);
            let keys = match &arr[1] {
                Value::Array(ks) => ks.iter().map(val_to_string).collect(),
                _ => Vec::new(),
            };
            (cursor, keys)
        }
        _ => (0, Vec::new()),
    }
}

/// Get the live session for a connection id.
pub async fn session(conn_id: &str) -> Result<Arc<Session>, String> {
    redisclient::get_session(conn_id).await
}

/// Fetch TTL (seconds) for a key. Returns -1 (no TTL), -2 (key missing), or the
/// remaining seconds.
pub async fn ttl(conn_id: &str, db: i64, key: &str) -> Result<i64, String> {
    let s = session(conn_id).await?;
    let v = s.query(db, vec!["TTL".to_string(), key.to_string()]).await?;
    Ok(val_to_i64(&v))
}

/// Fallback size when `MEMORY USAGE` is unavailable (older Redis, restricted ACL,
/// managed service). Uses the type-specific length command, which is universally
/// supported: STRLEN / HLEN / LLEN / SCARD / ZCARD / XLEN.
async fn fallback_size(s: &Session, db: i64, key: &str, type_str: &str) -> Option<i64> {
    let cmd = match type_str {
        "string" => "STRLEN",
        "hash" => "HLEN",
        "list" => "LLEN",
        "set" => "SCARD",
        "zset" => "ZCARD",
        "stream" => "XLEN",
        _ => return None,
    };
    s.query(db, vec![cmd.to_string(), key.to_string()])
        .await
        .ok()
        .map(|v| val_to_i64(&v))
}

/// Build a `KeyInfo` (type + TTL + size) for a key.
pub async fn key_info(conn_id: &str, db: i64, key: &str) -> Result<KeyInfo, String> {
    let s = session(conn_id).await?;
    let typ = s.query(db, vec!["TYPE".to_string(), key.to_string()]).await?;
    let type_str = val_to_string(&typ);
    let size = match s.query(db, vec!["MEMORY USAGE".to_string(), key.to_string()]).await {
        Ok(v) => {
            let n = val_to_i64(&v);
            if n > 0 {
                Some(n)
            } else {
                fallback_size(&s, db, key, &type_str).await
            }
        }
        Err(_) => fallback_size(&s, db, key, &type_str).await,
    };
    let encoding = s
        .query(db, vec!["OBJECT ENCODING".to_string(), key.to_string()])
        .await
        .ok()
        .map(|v| val_to_string(&v))
        .filter(|v| !v.is_empty());
    Ok(KeyInfo {
        key: key.to_string(),
        value_type: type_str,
        ttl: ttl(conn_id, db, key).await?,
        size,
        encoding,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use redis::Value;

    fn bs(s: &str) -> Value {
        Value::BulkString(s.as_bytes().to_vec())
    }

    #[test]
    fn test_parse_scan() {
        let v = Value::Array(vec![bs("12"), Value::Array(vec![bs("a"), bs("b"), bs("c")])]);
        let (cursor, keys) = parse_scan(&v);
        assert_eq!(cursor, 12);
        assert_eq!(keys, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn test_val_to_string() {
        assert_eq!(val_to_string(&bs("hello")), "hello");
        assert_eq!(val_to_string(&Value::Int(42)), "42");
        assert_eq!(val_to_string(&Value::Nil), "");
        assert_eq!(val_to_string(&Value::Okay), "OK");
        assert_eq!(val_to_string(&Value::SimpleString("pong".into())), "pong");
        assert_eq!(val_to_string(&Value::Boolean(true)), "true");
    }

    #[test]
    fn test_val_to_i64() {
        assert_eq!(val_to_i64(&Value::Int(7)), 7);
        assert_eq!(val_to_i64(&bs("123")), 123);
        assert_eq!(val_to_i64(&Value::Nil), 0);
        assert_eq!(val_to_i64(&bs("notnum")), 0);
    }

    #[test]
    fn test_val_to_string_array() {
        let v = Value::Array(vec![bs("LRANGE"), bs("0"), bs("1")]);
        assert_eq!(val_to_string(&v), "LRANGE, 0, 1");
    }
}
