use crate::commands::util::{session, val_to_i64};

#[tauri::command]
pub async fn create_key(conn_id: String, db: i64, key: String, value_type: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let args: Vec<String> = match value_type.as_str() {
        "string" => vec!["SET".to_string(), key, "".to_string()],
        "hash" => vec!["HSET".to_string(), key, "".to_string(), "".to_string()],
        "list" => vec!["RPUSH".to_string(), key, "".to_string()],
        "set" => vec!["SADD".to_string(), key, "".to_string()],
        "zset" => vec!["ZADD".to_string(), key, "0".to_string(), "".to_string()],
        other => return Err(format!("Unsupported key type: {other}")),
    };
    let _ = s.query(db, args).await?;
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
