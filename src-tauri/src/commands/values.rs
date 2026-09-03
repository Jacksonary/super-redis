use crate::commands::util::{parse_scan, session, val_to_i64, val_to_string};
use crate::types::{HashField, HashFieldsResult, ListItemsResult, SetMembersResult, StringValue};
use redis::Value;

// ─── String ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_value(conn_id: String, db: i64, key: String) -> Result<StringValue, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["GET".to_string(), key]).await?;
    match v {
        Value::Nil => Ok(StringValue { value: "(nil)".to_string(), is_binary: false }),
        Value::BulkString(b) => {
            let is_binary = std::str::from_utf8(&b).is_err();
            Ok(StringValue { value: String::from_utf8_lossy(&b).into_owned(), is_binary })
        }
        other => Ok(StringValue { value: val_to_string(&other), is_binary: false }),
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
            vec!["HSCAN".to_string(), key, cursor, "COUNT".to_string(), count.to_string()],
        )
        .await?;
    let (next, flat) = parse_scan(&v);
    let items = flat
        .chunks(2)
        .map(|pair| HashField {
            field: pair[0].clone(),
            value: pair.get(1).cloned().unwrap_or_default(),
        })
        .collect();
    Ok(HashFieldsResult { items, total: next as i64 })
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
    let _ = index;
    let v = s.query(db, vec!["LREM".to_string(), key, "0".to_string(), value]).await?;
    Ok(serde_json::json!({ "deleted": val_to_i64(&v) }))
}

#[tauri::command]
pub async fn set_list_value(conn_id: String, db: i64, key: String, index: i64, value: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["LSET".to_string(), key, index.to_string(), value]).await?;
    Ok(serde_json::json!({ "ok": true }))
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
            vec!["SSCAN".to_string(), key, cursor, "COUNT".to_string(), count.to_string()],
        )
        .await?;
    let (next, members) = parse_scan(&v);
    Ok(SetMembersResult { members, total: next as i64 })
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
