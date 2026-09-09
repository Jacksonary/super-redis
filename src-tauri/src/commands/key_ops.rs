use crate::commands::util::{session, val_to_i64};

#[tauri::command]
pub async fn create_key(
    conn_id: String,
    db: i64,
    key: String,
    value_type: String,
    value: Option<String>,
    // Multi-row payloads for the structured types. Fields are zebra-aligned with
    // values (hash: HSET field value pair-by-pair; zset: score+member). For
    // list/set, `values` holds the items and `fields`/`scores` are ignored.
    fields: Option<Vec<String>>,
    values: Option<Vec<String>>,
    scores: Option<Vec<f64>>,
    ttl: Option<i64>,
) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let value = value.unwrap_or_default();
    let fields = fields.unwrap_or_default();
    let values = values.unwrap_or_default();
    let scores = scores.unwrap_or_default();
    let args: Vec<String> = match value_type.as_str() {
        "string" => vec!["SET".to_string(), key.clone(), value],
        "hash" => {
            let mut a = vec!["HSET".to_string(), key.clone()];
            for (f, v) in fields.iter().zip(values.iter()) {
                a.push(f.clone());
                a.push(v.clone());
            }
            a
        }
        "list" | "set" => {
            let mut a = vec![
                if value_type == "list" { "RPUSH" } else { "SADD" }.to_string(),
                key.clone(),
            ];
            a.extend(values.iter().cloned());
            a
        }
        "zset" => {
            let mut a = vec!["ZADD".to_string(), key.clone()];
            for (sc, v) in scores.iter().zip(values.iter()) {
                a.push(sc.to_string());
                a.push(v.clone());
            }
            a
        }
        other => return Err(format!("Unsupported key type: {other}")),
    };
    let _ = s.query(db, args).await?;
    if let Some(secs) = ttl {
        if secs > 0 {
            let _ = s
                .query(db, vec!["EXPIRE".to_string(), key, secs.to_string()])
                .await?;
        }
    }
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn rename_key(conn_id: String, db: i64, src: String, dst: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    s.query(db, vec!["RENAME".to_string(), src, dst]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn copy_key(conn_id: String, db: i64, src: String, dst: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["COPY".to_string(), src, dst]).await?;
    Ok(serde_json::json!({ "ok": val_to_i64(&v) == 1 }))
}

#[tauri::command]
pub async fn move_key(conn_id: String, db: i64, key: String, dest_db: i64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["MOVE".to_string(), key, dest_db.to_string()]).await?;
    Ok(serde_json::json!({ "ok": val_to_i64(&v) == 1 }))
}

#[tauri::command]
pub async fn expire_key(conn_id: String, db: i64, key: String, seconds: i64) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s
        .query(db, vec!["EXPIRE".to_string(), key, seconds.to_string()])
        .await?;
    Ok(serde_json::json!({ "ok": val_to_i64(&v) == 1 }))
}

#[tauri::command]
pub async fn persist_key(conn_id: String, db: i64, key: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["PERSIST".to_string(), key]).await?;
    Ok(serde_json::json!({ "ok": val_to_i64(&v) == 1 }))
}

/// Alias for `expire_key`.
#[tauri::command]
pub async fn set_key_expire(conn_id: String, db: i64, key: String, seconds: i64) -> Result<serde_json::Value, String> {
    expire_key(conn_id, db, key, seconds).await
}
