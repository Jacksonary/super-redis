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
    // Delete in configurable batches with a throttle between batches so a large
    // selection (and the remote it hits) isn't slammed by one giant DEL.
    let st = crate::redisclient::load_settings();
    let batch = st.scan_count.clamp(1, 2000) as usize;
    let interval = st.operate_interval_ms;
    let mut deleted = 0i64;
    for chunk in keys.chunks(batch) {
        let mut args = vec!["DEL".to_string()];
        for k in chunk {
            args.push(k.clone());
        }
        let v = s.query(db, args).await?;
        deleted += val_to_i64(&v);
        if interval > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
        }
    }
    Ok(serde_json::json!({ "deleted": deleted }))
}

/// Unlink keys (asynchronous DELETE) so large values don't block the Redis event
/// loop. Same batching/throttle as delete_keys, but uses UNLINK instead of DEL.
#[tauri::command]
pub async fn unlink_keys(conn_id: String, db: i64, keys: Vec<String>) -> Result<serde_json::Value, String> {
    if keys.is_empty() {
        return Ok(serde_json::json!({ "deleted": 0 }));
    }
    let s = session(&conn_id).await?;
    let st = crate::redisclient::load_settings();
    let batch = st.scan_count.clamp(1, 2000) as usize;
    let interval = st.operate_interval_ms;
    let mut deleted = 0i64;
    for chunk in keys.chunks(batch) {
        let mut args = vec!["UNLINK".to_string()];
        for k in chunk {
            args.push(k.clone());
        }
        let v = s.query(db, args).await?;
        deleted += val_to_i64(&v);
        if interval > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
        }
    }
    Ok(serde_json::json!({ "deleted": deleted }))
}

/// Search history is kept in the frontend; this returns an empty list for now.
#[tauri::command]
pub fn get_search_history() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// Delete every key matching a glob pattern (used by the tree "delete folder"
/// action). SCANs the pattern and DELs in batches — never uses KEYS.
#[tauri::command]
pub async fn delete_keys_by_pattern(conn_id: String, db: i64, pattern: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let st = crate::redisclient::load_settings();
    let batch = st.scan_count.clamp(1, 2000) as usize;
    let interval = st.operate_interval_ms;
    let mut deleted = 0i64;
    let mut cursor = String::from("0");
    loop {
        let v = s
            .query(db, vec!["SCAN".to_string(), cursor.clone(), "MATCH".to_string(), pattern.clone(), "COUNT".to_string(), batch.to_string()])
            .await?;
        let (next, keys) = parse_scan(&v);
        if !keys.is_empty() {
            let mut args = vec!["DEL".to_string()];
            for k in keys {
                args.push(k);
            }
            let r = s.query(db, args).await?;
            deleted += val_to_i64(&r);
            // Throttle between batches so a huge prefix doesn't flood the remote.
            if interval > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
            }
        }
        cursor = next.to_string();
        if next == 0 {
            break;
        }
    }
    Ok(serde_json::json!({ "deleted": deleted }))
}
