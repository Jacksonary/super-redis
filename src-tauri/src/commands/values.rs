use crate::commands::util::{parse_scan, session, val_to_i64, val_to_string};
use crate::types::{HashField, HashFieldsResult, ListItemsResult, SetMembersResult, StringValue, ZSetItem, ZSetItemsResult};
use redis::Value;

// ─── String ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_value(conn_id: String, db: i64, key: String) -> Result<StringValue, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["GET".to_string(), key]).await?;
    match v {
        Value::Nil => Ok(StringValue { value: "(nil)".to_string(), is_binary: false, hex: None }),
        Value::BulkString(b) => {
            let is_binary = std::str::from_utf8(&b).is_err();
            let hex = if is_binary {
                Some(b.iter().map(|x| format!("{x:02x}")).collect::<String>())
            } else {
                None
            };
            Ok(StringValue { value: String::from_utf8_lossy(&b).into_owned(), is_binary, hex })
        }
        other => Ok(StringValue { value: val_to_string(&other), is_binary: false, hex: None }),
    }
}

#[tauri::command]
pub async fn set_value(conn_id: String, db: i64, key: String, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["SET".to_string(), key, value]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn set_value_with_ttl(
    conn_id: String,
    db: i64,
    key: String,
    value: String,
    ttl_seconds: i64,
) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(
        db,
        vec!["SET".to_string(), key, value, "EX".to_string(), ttl_seconds.to_string()],
    )
    .await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn get_key_type(conn_id: String, db: i64, key: String) -> Result<String, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["TYPE".to_string(), key]).await?;
    Ok(val_to_string(&v))
}

#[tauri::command]
pub async fn get_key_ttl(conn_id: String, db: i64, key: String) -> Result<i64, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["TTL".to_string(), key]).await?;
    Ok(val_to_i64(&v))
}

// ─── Hash ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_hash_fields(
    conn_id: String,
    db: i64,
    key: String,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<HashFieldsResult, String> {
    let s = session(&conn_id).await?;
    let cursor = cursor.unwrap_or_else(|| "0".into());
    let count = count.unwrap_or(500).clamp(1, 1000);
    let v = s
        .query(
            db,
            vec!["HSCAN".to_string(), key.clone(), cursor, "COUNT".to_string(), count.to_string()],
        )
        .await?;
    let (next, flat) = parse_scan(&v);
    let items: Vec<HashField> = flat
        .chunks(2)
        .map(|pair| HashField {
            field: pair[0].clone(),
            value: pair.get(1).cloned().unwrap_or_default(),
        })
        .collect();
    // HLEN gives the FULL field count, not just the current HSCAN page.
    let total = val_to_i64(&s.query(db, vec!["HLEN".to_string(), key]).await?);
    Ok(HashFieldsResult { items, cursor: next, total })
}

/// Search a hash for fields matching a pattern (HSCAN MATCH). Exact query uses
/// HGET for an O(1) value lookup.
#[tauri::command]
pub async fn search_hash_field(conn_id: String, db: i64, key: String, field: String) -> Result<HashFieldsResult, String> {
    let s = session(&conn_id).await?;
    let is_pattern = field.contains('*') || field.contains('?') || field.contains('[');
    if !is_pattern {
        let v = s.query(db, vec!["HGET".to_string(), key.clone(), field.clone()]).await?;
        let value = val_to_string(&v);
        let items = if v != Value::Nil { vec![HashField { field, value }] } else { Vec::new() };
        return Ok(HashFieldsResult { items, cursor: 0, total: val_to_i64(&s.query(db, vec!["HLEN".to_string(), key]).await?) });
    }
    let mut cursor = String::from("0");
    let mut flat = Vec::new();
    loop {
        let v = s.query(db, vec!["HSCAN".to_string(), key.clone(), cursor.clone(), "MATCH".to_string(), field.clone(), "COUNT".to_string(), "500".to_string()]).await?;
        let (next, page) = parse_scan(&v);
        flat.extend(page);
        cursor = next.to_string();
        if next == 0 { break; }
    }
    let items: Vec<HashField> = flat.chunks(2).map(|pair| HashField {
        field: pair[0].clone(),
        value: pair.get(1).cloned().unwrap_or_default(),
    }).collect();
    let total = val_to_i64(&s.query(db, vec!["HLEN".to_string(), key]).await?);
    Ok(HashFieldsResult { items, cursor: 0, total })
}

#[tauri::command]
pub async fn get_hash_field(conn_id: String, db: i64, key: String, field: String) -> Result<String, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["HGET".to_string(), key, field]).await?;
    Ok(val_to_string(&v))
}

#[tauri::command]
pub async fn set_hash_field(conn_id: String, db: i64, key: String, field: String, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["HSET".to_string(), key, field, value]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn delete_hash_field(conn_id: String, db: i64, key: String, fields: Vec<String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["HDEL".to_string(), key];
    for f in fields {
        args.push(f);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "deleted": val_to_i64(&v) }))
}

/// Rename a hash field (and set its value): HDEL the old field, then HSET the
/// new field = value. If the field name is unchanged, this is just an HSET.
#[tauri::command]
pub async fn rename_hash_field(conn_id: String, db: i64, key: String, old_field: String, new_field: String, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    if old_field != new_field {
        s.query(db, vec!["HDEL".to_string(), key.clone(), old_field]).await?;
    }
    s.query(db, vec!["HSET".to_string(), key, new_field, value]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

// ─── List ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_list_items(
    conn_id: String,
    db: i64,
    key: String,
    start: i64,
    stop: i64,
) -> Result<ListItemsResult, String> {
    let s = session(&conn_id).await?;
    let len = val_to_i64(
        &s.query(db, vec!["LLEN".to_string(), key.clone()]).await?,
    );
    let v = s
        .query(db, vec!["LRANGE".to_string(), key, start.to_string(), stop.to_string()])
        .await?;
    let items = match v {
        Value::Array(list) => list.iter().map(val_to_string).collect(),
        _ => Vec::new(),
    };
    Ok(ListItemsResult { items, total: len })
}

#[tauri::command]
pub async fn push_list_item(conn_id: String, db: i64, key: String, value: String, left: bool) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let cmd = if left { "LPUSH" } else { "RPUSH" };
    let v = s.query(db, vec![cmd.to_string(), key, value]).await?;
    Ok(serde_json::json!({ "ok": true, "length": val_to_i64(&v) }))
}

#[tauri::command]
pub async fn delete_list_item(conn_id: String, db: i64, key: String, value: String, index: Option<i64>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    // With an explicit index, delete exactly that element: overwrite it with a
    // unique sentinel, then LREM that sentinel once. Without an index, fall back
    // to removing all elements equal to `value`.
    match index {
        Some(idx) if idx >= 0 => {
            let sentinel = format!("__sr_del_{}_{}", uuid::Uuid::new_v4(), idx);
            s.query(db, vec!["LSET".to_string(), key.clone(), idx.to_string(), sentinel.clone()]).await?;
            let v = s.query(db, vec!["LREM".to_string(), key, "1".to_string(), sentinel]).await?;
            Ok(serde_json::json!({ "deleted": val_to_i64(&v) }))
        }
        _ => {
            let v = s.query(db, vec!["LREM".to_string(), key, "0".to_string(), value]).await?;
            Ok(serde_json::json!({ "deleted": val_to_i64(&v) }))
        }
    }
}

#[tauri::command]
pub async fn set_list_value(conn_id: String, db: i64, key: String, index: i64, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["LSET".to_string(), key, index.to_string(), value]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Search a list for the index of a value using LPOS (Redis 6+). Returns the
/// matching element + its index.
#[tauri::command]
pub async fn search_list_value(conn_id: String, db: i64, key: String, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["LPOS".to_string(), key.clone(), value.clone()]).await?;
    let index = match v {
        Value::Int(i) => i,
        _ => -1,
    };
    let found = index >= 0;
    let len = val_to_i64(&s.query(db, vec!["LLEN".to_string(), key]).await?);
    Ok(serde_json::json!({ "found": found, "index": index, "value": value, "total": len }))
}

// ─── Set ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_set_items(
    conn_id: String,
    db: i64,
    key: String,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<SetMembersResult, String> {
    let s = session(&conn_id).await?;
    let cursor = cursor.unwrap_or_else(|| "0".into());
    let count = count.unwrap_or(500).clamp(1, 1000);
    let v = s
        .query(
            db,
            vec!["SSCAN".to_string(), key.clone(), cursor, "COUNT".to_string(), count.to_string()],
        )
        .await?;
    let (next, members) = parse_scan(&v);
    // SCARD gives the FULL cardinality, not just the current SCAN page.
    let total = val_to_i64(&s.query(db, vec!["SCARD".to_string(), key]).await?);
    Ok(SetMembersResult { members, cursor: next, total })
}

/// Search a set for members matching a pattern (SSCAN MATCH). When no wildcard,
/// uses SISMEMBER for an exact membership check and returns a single hit/no-hit.
#[tauri::command]
pub async fn search_set_member(conn_id: String, db: i64, key: String, member: String) -> Result<SetMembersResult, String> {
    let s = session(&conn_id).await?;
    let is_pattern = member.contains('*') || member.contains('?') || member.contains('[');
    if !is_pattern {
        // Exact: O(1) membership check.
        let exists = val_to_i64(&s.query(db, vec!["SISMEMBER".to_string(), key.clone(), member.clone()]).await?);
        let members = if exists == 1 { vec![member] } else { Vec::new() };
        return Ok(SetMembersResult { members, cursor: 0, total: val_to_i64(&s.query(db, vec!["SCARD".to_string(), key]).await?) });
    }
    // Wildcard: SSCAN MATCH until cursor ends.
    let mut cursor = String::from("0");
    let mut members = Vec::new();
    loop {
        let v = s.query(db, vec!["SSCAN".to_string(), key.clone(), cursor.clone(), "MATCH".to_string(), member.clone(), "COUNT".to_string(), "500".to_string()]).await?;
        let (next, page) = parse_scan(&v);
        members.extend(page);
        cursor = next.to_string();
        if next == 0 { break; }
    }
    let total = val_to_i64(&s.query(db, vec!["SCARD".to_string(), key]).await?);
    Ok(SetMembersResult { members, cursor: 0, total })
}

#[tauri::command]
pub async fn add_set_item(conn_id: String, db: i64, key: String, members: Vec<String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["SADD".to_string(), key];
    for m in members {
        args.push(m);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "added": val_to_i64(&v) }))
}

#[tauri::command]
pub async fn delete_set_item(conn_id: String, db: i64, key: String, members: Vec<String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["SREM".to_string(), key];
    for m in members {
        args.push(m);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "removed": val_to_i64(&v) }))
}

/// Rename a set member: SREM the old value then SADD the new one.
#[tauri::command]
pub async fn rename_set_member(conn_id: String, db: i64, key: String, old_member: String, new_member: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["SREM".to_string(), key.clone(), old_member]).await?;
    s.query(db, vec!["SADD".to_string(), key, new_member]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

// ─── ZSet ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_zset_items(
    conn_id: String,
    db: i64,
    key: String,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<ZSetItemsResult, String> {
    let s = session(&conn_id).await?;
    let cursor = cursor.unwrap_or_else(|| "0".into());
    let count = count.unwrap_or(500).clamp(1, 1000);
    let v = s
        .query(
            db,
            vec!["ZSCAN".to_string(), key.clone(), cursor, "COUNT".to_string(), count.to_string()],
        )
        .await?;
    let (next, flat) = parse_scan(&v);
    let items: Vec<ZSetItem> = flat
        .chunks(2)
        .map(|c| ZSetItem {
            member: c[0].clone(),
            score: c.get(1).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0),
        })
        .collect();
    // ZCARD gives the FULL cardinality, not just the current SCAN page.
    let total = val_to_i64(&s.query(db, vec!["ZCARD".to_string(), key]).await?);
    Ok(ZSetItemsResult { items, cursor: next, total })
}

/// Search a sorted set for members matching a pattern (ZSCAN MATCH). Exact query
/// uses ZSCORE for an O(1) score lookup.
#[tauri::command]
pub async fn search_zset_member(conn_id: String, db: i64, key: String, member: String) -> Result<ZSetItemsResult, String> {
    let s = session(&conn_id).await?;
    let is_pattern = member.contains('*') || member.contains('?') || member.contains('[');
    if !is_pattern {
        let v = s.query(db, vec!["ZSCORE".to_string(), key.clone(), member.clone()]).await?;
        let score = val_to_string(&v).parse::<f64>().ok();
        let items = match score {
            Some(sc) => vec![ZSetItem { member, score: sc }],
            None => Vec::new(),
        };
        return Ok(ZSetItemsResult { items, cursor: 0, total: val_to_i64(&s.query(db, vec!["ZCARD".to_string(), key]).await?) });
    }
    let mut cursor = String::from("0");
    let mut flat = Vec::new();
    loop {
        let v = s.query(db, vec!["ZSCAN".to_string(), key.clone(), cursor.clone(), "MATCH".to_string(), member.clone(), "COUNT".to_string(), "500".to_string()]).await?;
        let (next, page) = parse_scan(&v);
        flat.extend(page);
        cursor = next.to_string();
        if next == 0 { break; }
    }
    let items: Vec<ZSetItem> = flat.chunks(2).map(|c| ZSetItem {
        member: c[0].clone(),
        score: c.get(1).and_then(|x| x.parse::<f64>().ok()).unwrap_or(0.0),
    }).collect();
    let total = val_to_i64(&s.query(db, vec!["ZCARD".to_string(), key]).await?);
    Ok(ZSetItemsResult { items, cursor: 0, total })
}

/// Update a member's score in a sorted set (ZADD).
#[tauri::command]
pub async fn update_zset_score(conn_id: String, db: i64, key: String, member: String, score: f64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["ZADD".to_string(), key, score.to_string(), member]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Rename a zset member (and update its score): ZREM the old member, then ZADD
/// the new member = score. If the member is unchanged, this is just a ZADD.
#[tauri::command]
pub async fn rename_zset_member(conn_id: String, db: i64, key: String, old_member: String, new_member: String, score: f64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    if old_member != new_member {
        s.query(db, vec!["ZREM".to_string(), key.clone(), old_member]).await?;
    }
    s.query(db, vec!["ZADD".to_string(), key, score.to_string(), new_member]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn add_zset_item(conn_id: String, db: i64, key: String, member: String, score: f64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s
        .query(db, vec!["ZADD".to_string(), key, score.to_string(), member])
        .await?;
    Ok(serde_json::json!({ "added": val_to_i64(&v) }))
}

#[tauri::command]
pub async fn delete_zset_item(conn_id: String, db: i64, key: String, members: Vec<String>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let mut args = vec!["ZREM".to_string(), key];
    for m in members {
        args.push(m);
    }
    let v = s.query(db, args).await?;
    Ok(serde_json::json!({ "removed": val_to_i64(&v) }))
}
