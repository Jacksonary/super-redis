use crate::commands::util::{key_info, parse_scan, session, val_to_i64};
use crate::types::{KeyInfo, ListKeysResult};

/// SCAN-based key listing with a `MATCH` pattern and cursor pagination.
///
/// The list only returns key names (plus the cursor) — key metadata (type, TTL,
/// size) is fetched lazily via `get_key_info` when a key is opened, so a large
/// page never triggers a per-key round trip.
#[tauri::command]
pub async fn list_keys(
    conn_id: String,
    db: i64,
    pattern: Option<String>,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<ListKeysResult, String> {
    let s = session(&conn_id).await?;
    let pattern = pattern.filter(|p| !p.is_empty()).unwrap_or_else(|| "*".into());
    let cursor = cursor.unwrap_or_else(|| "0".into());
    let count = count.unwrap_or(500).clamp(1, 1000);

    let mut args = vec!["SCAN".to_string(), cursor];
    if pattern != "*" {
        args.push("MATCH".to_string());
        args.push(pattern);
    }
    args.push("COUNT".to_string());
    args.push(count.to_string());

    let v = s.query(db, args).await?;
    let (next_cursor, keys) = parse_scan(&v);

    Ok(ListKeysResult {
        keys,
        cursor: next_cursor,
        is_truncated: next_cursor != 0,
    })
}

/// Alias of `list_keys` kept for scan-first call sites.
#[tauri::command]
pub async fn scan_keys(
    conn_id: String,
    db: i64,
    pattern: Option<String>,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<ListKeysResult, String> {
    list_keys(conn_id, db, pattern, cursor, count).await
}

/// Pattern search over keys (SCAN under the hood; never KEYS).
#[tauri::command]
pub async fn search_keys(
    conn_id: String,
    db: i64,
    pattern: String,
    cursor: Option<String>,
    count: Option<i64>,
) -> Result<ListKeysResult, String> {
    list_keys(conn_id, db, Some(pattern), cursor, count).await
}

/// Full metadata for a single key.
#[tauri::command]
pub async fn get_key_info(conn_id: String, db: i64, key: String) -> Result<KeyInfo, String> {
    key_info(&conn_id, db, &key).await
}

/// Number of keys in the selected database (DBSIZE).
#[tauri::command]
pub async fn get_key_count(conn_id: String, db: i64) -> Result<i64, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["DBSIZE".to_string()]).await?;
    Ok(val_to_i64(&v))
}

/// Alias for `get_key_count`.
#[tauri::command]
pub async fn get_db_size(conn_id: String, db: i64) -> Result<i64, String> {
    get_key_count(conn_id, db).await
}

/// Delete a batch of keys; returns the number actually deleted.
#[tauri::command]
pub async fn delete_keys(conn_id: String, db: i64, keys: Vec<String>) -> Result<serde_json::Value, String> {
    if keys.is_empty() {
        return Ok(serde_json::json!({ "deleted": 0 }));
    }
    let s = session(&conn_id).await?;
    let mut args = vec!["DEL".to_string()];
    for k in keys {
        args.push(k);
    }
    let v = s.query(db, args).await?;
    let deleted = val_to_i64(&v);
    Ok(serde_json::json!({ "deleted": deleted }))
}

/// Search history is kept in the frontend; this returns an empty list for now.
#[tauri::command]
pub fn get_search_history() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
