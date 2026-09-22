use crate::commands::util::{key_info, parse_scan, session, val_to_i64, val_to_string};
use crate::types::{KeyInfo, ListKeysResult};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// Scan budget for one wildcard search round (one `invoke`). When it is spent the
/// reply carries a cursor for the next round, which the UI pays for with "Load
/// more". Hardcoded on purpose for now — not a setting.
const SEARCH_SCAN_BUDGET: usize = 10_000;

/// Upper bound on rounds per round-trip, so the budget cannot be turned into a
/// long throttled loop by a small `COUNT` (COUNT 1 would ask for 10,000 rounds,
/// each sleeping `operate_interval_ms`). The UI always sends the ceiling, where
/// both limits agree at 10.
const MAX_SEARCH_ROUNDS: usize = 20;

/// SCAN `COUNT` fallback and ceiling. The UI asks for exactly the ceiling, so
/// raising it there alone changes nothing: both sides move together.
const DEFAULT_SCAN_COUNT: i64 = 1_000;
const MAX_SCAN_COUNT: i64 = 1_000;

/// Whether a search term has to go through SCAN's glob matching.
///
/// Deliberately conservative: reading a literal key as a pattern costs one extra
/// scan, while the opposite mistake answers "this key does not exist" for a key
/// that does — a silent wrong answer, and exactly the confusion this fast path
/// exists to remove.
fn has_glob_meta(p: &str) -> bool {
    p.contains(['*', '?', '[', ']', '\\'])
}

/// Live search per connection: `conn_id -> search_id`.
///
/// A fresh search overwrites the entry, and the older round notices at its next
/// SCAN boundary that it is no longer current and returns early. Without this,
/// pressing Enter a few times in a row leaves several keyspace walks running
/// against the same instance at once.
fn current_searches() -> &'static Mutex<HashMap<String, String>> {
    static CURRENT: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CURRENT.get_or_init(|| Mutex::new(HashMap::new()))
}

fn claim_search(conn_id: &str, search_id: &Option<String>) {
    if let Some(id) = search_id {
        current_searches()
            .lock()
            .unwrap()
            .insert(conn_id.to_string(), id.clone());
    }
}

fn search_is_current(conn_id: &str, search_id: &Option<String>) -> bool {
    // Callers that pass no id are never cancelled.
    let Some(id) = search_id else {
        return true;
    };
    current_searches()
        .lock()
        .unwrap()
        .get(conn_id)
        .map(|cur| cur == id)
        .unwrap_or(true)
}

/// List or search keys: one BOUNDED scan round per call.
///
/// The shape is picked from the pattern and cursor:
/// - literal key name on the first round → `TYPE` (O(1)) and return it, alone
/// - empty pattern (browse) → a single SCAN page; "Load more" walks further
/// - wildcard pattern → SCAN+MATCH in a loop, until the cursor wraps to 0 or the
///   budget is spent, whichever comes first
///
/// `TYPE` rather than `GET` for the literal path: GET is string-only and answers
/// WRONGTYPE for a hash/list/set/zset/stream key, so it cannot answer "does this
/// key exist" for most real keys.
///
/// Cluster: SCAN is not key-addressed, so redis-rs runs it on whichever node the
/// command lands on and the listing covers only that node. The literal-key fast
/// path is unaffected — TYPE routes by key slot like any other key command.
#[tauri::command]
pub async fn list_keys(
    conn_id: String,
    db: i64,
    pattern: Option<String>,
    cursor: Option<String>,
    count: Option<i64>,
    search_id: Option<String>,
) -> Result<ListKeysResult, String> {
    let s = session(&conn_id).await?;
    let pattern = pattern.unwrap_or_default();
    let count = count.unwrap_or(DEFAULT_SCAN_COUNT).clamp(1, MAX_SCAN_COUNT) as usize;
    let cursor_in = cursor.unwrap_or_else(|| "0".into());

    // Claimed before the fast path can return: a literal-key search is a new
    // search too, and it has to stop the wildcard round it supersedes — otherwise
    // that round keeps walking its budget on the instance with nobody listening.
    claim_search(&conn_id, &search_id);

    // A literal key name, asked for from the start: answer it in one O(1) round
    // trip instead of walking the keyspace until the cursor happens to reach it.
    if cursor_in == "0" && !pattern.is_empty() && !has_glob_meta(&pattern) {
        let v = s
            .query(db, vec!["TYPE".to_string(), pattern.clone()])
            .await?;
        let found = val_to_string(&v) != "none";
        return Ok(ListKeysResult {
            keys: if found { vec![pattern] } else { Vec::new() },
            cursor: 0,
            is_truncated: false,
            complete: true,
            scanned: 0,
            exact: true,
        });
    }

    let browsing = pattern.is_empty();
    // Browsing is one page per call (the UI accumulates pages); a search loops
    // until it is done or out of budget.
    let max_rounds = if browsing {
        1
    } else {
        ((SEARCH_SCAN_BUDGET + count - 1) / count).min(MAX_SEARCH_ROUNDS)
    };
    // Read once, and only on the path that loops — the fast path above should not
    // pay a settings file read.
    let interval = crate::redisclient::load_settings().operate_interval_ms;

    let mut cursor = cursor_in;
    let mut keys: Vec<String> = Vec::new();
    let mut rounds = 0usize;
    let mut scanned_exact = 0u64;
    let mut complete = false;

    loop {
        let mut args = vec!["SCAN".to_string(), cursor.clone()];
        if !browsing {
            args.push("MATCH".to_string());
            args.push(pattern.clone());
        }
        args.push("COUNT".to_string());
        args.push(count.to_string());

        let v = s.query(db, args).await?;
        let (next, batch) = parse_scan(&v);
        rounds += 1;
        scanned_exact += batch.len() as u64;
        keys.extend(batch);

        if next == 0 {
            complete = true;
            cursor = "0".to_string();
            break;
        }
        cursor = next.to_string();
        if rounds >= max_rounds {
            break;
        }
        // Same throttle as the batch-delete paths, so a wide search paces itself
        // against the instance instead of hammering it back to back.
        if interval > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(interval)).await;
        }
        // Checked after the throttle so a superseded round exits at its next
        // boundary rather than carrying on for another page.
        if !search_is_current(&conn_id, &search_id) {
            break;
        }
    }

    // Without MATCH every returned key was walked, so the figure is exact. With
    // MATCH the reply carries only the matches and never says how many keys were
    // looked at, so the budget itself (rounds × COUNT) is the best available.
    let scanned = if browsing {
        scanned_exact
    } else {
        (rounds * count) as u64
    };

    Ok(ListKeysResult {
        keys,
        cursor: cursor.parse::<u64>().unwrap_or(0),
        is_truncated: !complete,
        complete,
        scanned,
        exact: false,
    })
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

#[cfg(test)]
mod tests {
    use super::has_glob_meta;

    #[test]
    fn literal_key_names_are_not_patterns() {
        assert!(!has_glob_meta("task:event-purge-stop"));
        assert!(!has_glob_meta("a"));
        assert!(!has_glob_meta(""));
    }

    #[test]
    fn every_glob_metacharacter_forces_the_scan_path() {
        for p in ["*", "task:*", "a?b", "a[0-9]", "a]", r"a\*b"] {
            assert!(has_glob_meta(p), "{p} should be treated as a pattern");
        }
    }
}
