use crate::commands::util::{parse_scan, session, val_to_i64, val_to_string};
use redis::Value;

/// Convert a `redis::Value` tree into a `serde_json::Value` for the frontend.
fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Nil => serde_json::Value::Null,
        Value::BulkString(b) => serde_json::Value::String(String::from_utf8_lossy(b).into_owned()),
        Value::Int(i) => serde_json::Value::from(*i),
        Value::Double(d) => serde_json::Value::from(*d),
        Value::Boolean(b) => serde_json::Value::Bool(*b),
        Value::SimpleString(s) => serde_json::Value::String(s.clone()),
        Value::Okay => serde_json::Value::String("OK".into()),
        Value::Array(a) => serde_json::Value::Array(a.iter().map(value_to_json).collect()),
        Value::Set(a) => serde_json::Value::Array(a.iter().map(value_to_json).collect()),
        Value::Map(m) => {
            let mut map = serde_json::Map::new();
            for (k, val) in m {
                map.insert(val_to_string(k), value_to_json(val));
            }
            serde_json::Value::Object(map)
        }
        Value::VerbatimString { text, .. } => serde_json::Value::String(text.clone()),
        Value::Push { data, .. } => serde_json::Value::Array(data.iter().map(value_to_json).collect()),
        Value::Attribute { data, .. } => value_to_json(data),
        Value::ServerError(e) => serde_json::Value::String(format!("ERR: {e:?}")),
        unk => serde_json::Value::String(format!("{unk:?}")),
    }
}

/// Number of configured database slots (CONFIG GET databases).
#[tauri::command]
pub async fn get_db_count(conn_id: String) -> Result<i64, String> {
    let s = session(&conn_id).await?;
    let v = s
        .query_str(s.conn.db, vec!["CONFIG".to_string(), "GET".to_string(), "databases".to_string()])
        .await?;
    let text = val_to_string(&v);
    // CONFIG GET databases -> ["databases","16"] (RESP2 array) or a Map (RESP3).
    let digits: String = text.chars().filter(|c| c.is_ascii_digit()).collect();
    Ok(digits.parse::<i64>().unwrap_or(16).max(1))
}

/// Parse INFO into `{ section: { key: value } }`. Handles RESP2 (bulk string with
/// `# section` headers) and RESP3 (a `Map`).
fn parse_info(v: &Value) -> serde_json::Value {
    let text = match v {
        Value::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        Value::Map(_) => return value_to_json(v),
        other => val_to_string(other),
    };
    let mut sections: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
    let mut cur = "all".to_string();
    sections.insert(cur.clone(), serde_json::json!({}));
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(sec) = line.strip_prefix('#') {
            cur = sec.trim().to_lowercase();
            if !sections.contains_key(&cur) {
                sections.insert(cur.clone(), serde_json::json!({}));
            }
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            if let Some(serde_json::Value::Object(map)) = sections.get_mut(&cur) {
                map.insert(k.trim().to_string(), serde_json::Value::String(v.trim().to_string()));
            }
        }
    }
    serde_json::Value::Object(sections)
}

/// Full `INFO` output parsed into sections (server / memory / stats / keyspace…).
#[tauri::command]
pub async fn get_server_info(conn_id: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(s.conn.db, vec!["INFO".to_string()]).await?;
    Ok(parse_info(&v))
}

/// Slow log entries (SLOWLOG GET up to 20).
#[tauri::command]
pub async fn get_slowlog(conn_id: String, db: i64, count: Option<i64>) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let n = count.unwrap_or(20).clamp(1, 128).to_string();
    let v = s.query(db, vec!["SLOWLOG".to_string(), "GET".to_string(), n]).await?;
    let rows: Vec<serde_json::Value> = match v {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|entry| match entry {
                Value::Array(e) => Some(serde_json::json!({
                    "id": e.get(0).map(val_to_string).unwrap_or_default(),
                    "timestamp": e.get(1).map(val_to_i64).unwrap_or(0),
                    "duration_us": e.get(2).map(val_to_i64).unwrap_or(0),
                    "command": match e.get(3) {
                        Some(Value::Array(c)) => c.iter().map(val_to_string).collect::<Vec<_>>().join(" "),
                        _ => String::new(),
                    },
                    "client": e.get(4).map(val_to_string).unwrap_or_default(),
                })),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(serde_json::json!({ "entries": rows }))
}

#[tauri::command]
pub async fn clear_slowlog(conn_id: String, db: i64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let _ = s.query(db, vec!["SLOWLOG".to_string(), "RESET".to_string()]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[derive(serde::Serialize)]
pub struct MemoryStat {
    key: String,
    size: i64,
}

/// Sample memory usage across keys: SCAN a bounded number of keys, then resolve
/// TYPE + MEMORY USAGE for each in a single pipeline per measurement. Returns the
/// biggest keys first. Keys with no reported allocation get size = -1.
#[tauri::command]
pub async fn analyze_memory(
    conn_id: String,
    db: i64,
    pattern: Option<String>,
    sample: Option<i64>,
) -> Result<Vec<MemoryStat>, String> {
    let s = session(&conn_id).await?;
    let sample = sample.unwrap_or(2000).clamp(1, 20000);
    let pattern = pattern.filter(|p| !p.is_empty());

    let mut cursor: u64 = 0;
    let mut keys: Vec<String> = Vec::new();
    loop {
        let mut args = vec!["SCAN".to_string(), cursor.to_string()];
        if let Some(p) = &pattern {
            args.push("MATCH".to_string());
            args.push(p.clone());
        }
        args.push("COUNT".to_string());
        args.push("1000".to_string());
        let v = s.query(db, args).await?;
        let (next, batch) = parse_scan(&v);
        keys.extend(batch);
        cursor = next;
        if cursor == 0 || keys.len() >= sample as usize {
            break;
        }
    }
    keys.truncate(sample as usize);
    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let mem_cmds: Vec<Vec<String>> = keys
        .iter()
        .map(|k| vec!["MEMORY".to_string(), "USAGE".to_string(), k.clone()])
        .collect();
    let mem_vals = s.run_cmds(db, mem_cmds).await.unwrap_or_default();

    let mut stats: Vec<MemoryStat> = Vec::new();
    for (i, k) in keys.iter().enumerate() {
        let size = match mem_vals.get(i) {
            Some(Value::Nil) => -1,
            Some(v) => val_to_i64(v),
            None => -1,
        };
        stats.push(MemoryStat { key: k.clone(), size });
    }
    stats.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(stats)
}

/// Current connected clients (CLIENT LIST) parsed into `{ field: value }` rows,
/// plus the id of the current connection (`CLIENT ID`) so the UI can highlight
/// "this" client vs other connections.
#[tauri::command]
pub async fn list_clients(conn_id: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let idv = s.query_str(s.conn.db, vec!["CLIENT".to_string(), "ID".to_string()]).await?;
    let self_id = val_to_i64(&idv);
    let v = s.query_str(s.conn.db, vec!["CLIENT".to_string(), "LIST".to_string()]).await?;
    let text = val_to_string(&v);
    let rows: Vec<serde_json::Value> = text
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let mut map = serde_json::Map::new();
            for token in line.split_whitespace() {
                if let Some((k, val)) = token.split_once('=') {
                    map.insert(k.to_string(), serde_json::Value::String(val.to_string()));
                }
            }
            serde_json::Value::Object(map)
        })
        .collect();
    Ok(serde_json::json!({ "clients": rows, "selfId": self_id }))
}

/// Kill a client by id (CLIENT KILL ID <id>).
#[tauri::command]
pub async fn kill_client(conn_id: String, id: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let _ = s
        .query_str(s.conn.db, vec!["CLIENT".to_string(), "KILL".to_string(), "ID".to_string(), id])
        .await?;
    Ok(serde_json::json!({ "ok": true }))
}

/// `INFO commandstats` parsed into `{ command, calls, usec, usec_per_call, ... }`.
#[tauri::command]
pub async fn get_command_stats(conn_id: String) -> Result<Vec<serde_json::Value>, String> {
    let s = session(&conn_id).await?;
    let v = s.query_str(s.conn.db, vec!["INFO".to_string(), "commandstats".to_string()]).await?;
    let text = val_to_string(&v);
    let mut rows: Vec<serde_json::Value> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((cmd, stats)) = line.split_once(':') {
            let cmd = cmd.strip_prefix("cmdstat_").unwrap_or(cmd).to_string();
            let mut obj = serde_json::Map::new();
            obj.insert("command".to_string(), serde_json::Value::String(cmd));
            for pair in stats.split(',') {
                if let Some((k, val)) = pair.split_once('=') {
                    obj.insert(
                        k.trim().to_string(),
                        serde_json::Value::from(val.trim().parse::<f64>().unwrap_or(0.0)),
                    );
                }
            }
            rows.push(serde_json::Value::Object(obj));
        }
    }
    Ok(rows)
}

/// `LATENCY LATEST` parsed into per-command latest/max latency events.
#[tauri::command]
pub async fn get_latency(conn_id: String) -> Result<Vec<serde_json::Value>, String> {
    let s = session(&conn_id).await?;
    let v = s.query(s.conn.db, vec!["LATENCY".to_string(), "LATEST".to_string()]).await?;
    let rows: Vec<serde_json::Value> = match v {
        Value::Array(arr) => arr
            .iter()
            .filter_map(|item| match item {
                Value::Array(e) => Some(serde_json::json!({
                    "command": e.get(0).map(val_to_string).unwrap_or_default(),
                    "timestamp": e.get(1).map(val_to_i64).unwrap_or(0),
                    "latest": e.get(2).map(val_to_i64).unwrap_or(0),
                    "max": e.get(3).map(val_to_i64).unwrap_or(0),
                })),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    Ok(rows)
}
