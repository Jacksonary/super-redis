use crate::redisclient;
use crate::types::ConnectionStateEvent;
use crate::types::ConnectionSummary;
use tauri::Emitter;

fn summary_of(conn: &crate::types::Connection) -> ConnectionSummary {
    ConnectionSummary {
        id: conn.id.clone().unwrap_or_default(),
        name: redisclient::display_name(conn),
        color: conn.color.clone(),
        group: conn.group.clone(),
        host: conn.host.clone(),
        port: conn.port,
        db: conn.db,
        mode: conn.mode.clone(),
        readonly: conn.readonly,
        tls: conn.tls.enabled,
        status: None,
    }
}

#[tauri::command]
pub async fn list_connections() -> Result<Vec<ConnectionSummary>, String> {
    redisclient::list_connection_summaries()
}

/// Reorder every connection to match the given id order.
///
/// The connections array order in `config.json` is the single source of truth
/// for display order: row sorting inside the sidebar AND group sorting (a
/// group's position is where its first member sits) both derive from it. The
/// client sends the full id list in its final order after a drag; the server
/// validates it is exactly the stored id set (a permutation only) and rewrites
/// the array. Purely cosmetic — no keychain access, no session drops.
#[tauri::command]
pub async fn reorder_connections(
    ordered: Vec<crate::types::ConnectionOrdering>,
) -> Result<serde_json::Value, String> {
    use std::collections::HashMap;

    let mut cfg = redisclient::load_config_meta()?;
    let by_id: HashMap<String, crate::types::Connection> = cfg
        .connections
        .iter()
        .filter_map(|c| c.id.clone().map(|id| (id, c.clone())))
        .collect();
    if ordered.len() != by_id.len() {
        return Err("Reorder rejected: id list does not match stored connections".to_string());
    }
    let mut out = Vec::with_capacity(ordered.len());
    for slot in &ordered {
        match by_id.get(&slot.id) {
            Some(c) => {
                // Reordering alone is not enough: the caller's intent also sets
                // which group each connection ends up in (a cross-group drop
                // moves membership). Both are written in one round-trip.
                let mut c = c.clone();
                c.group = slot.group.clone();
                out.push(c);
            }
            None => return Err(format!("Reorder rejected: unknown connection id {}", slot.id)),
        }
    }
    cfg.connections = out;
    redisclient::save_config_meta(&cfg)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn create_connection(mut conn: crate::types::Connection) -> Result<ConnectionSummary, String> {
    if conn.id.is_none() {
        conn.id = Some(uuid::Uuid::new_v4().to_string());
    }
    redisclient::sync_acl_enabled(&mut conn);
    let mut cfg = redisclient::load_config_meta()?;
    cfg.connections.push(conn.clone());
    redisclient::save_config_meta(&cfg)?;
    // Only reaches for the master key when there is actually a password to store.
    let _ = redisclient::apply_secret_intent(&conn)?;
    // New connection — no live session exists for its id, nothing to drop.
    Ok(summary_of(&conn))
}

/// Update a connection.
///
/// Metadata and credentials go through separate paths on purpose: the common case
/// (rename, port change, group change) leaves `acl.password` empty, which means
/// "keep what is stored" and needs no master key at all. Only a real password
/// change or an explicit clear touches the encrypted store.
#[tauri::command]
pub async fn update_connection(
    mut conn: crate::types::Connection,
    app: tauri::AppHandle,
) -> Result<ConnectionSummary, String> {
    let conn_id = conn.id.clone().ok_or("Connection id missing")?;
    redisclient::sync_acl_enabled(&mut conn);
    let mut cfg = redisclient::load_config_meta()?;
    let old = cfg
        .connections
        .iter()
        .find(|c| c.id.as_deref() == Some(conn_id.as_str()))
        .cloned()
        .ok_or("Connection not found")?;
    cfg.connections
        .iter_mut()
        .find(|c| c.id.as_deref() == Some(conn_id.as_str()))
        .map(|c| *c = conn.clone())
        .ok_or("Connection not found")?;
    redisclient::save_config_meta(&cfg)?;
    // Drop the live session only when the edit touches how it connects or
    // authenticates. Purely cosmetic fields (name/group/color/encoding) are
    // ignored by the diff, so those edits leave an active connection alone.
    let secret_changed = redisclient::apply_secret_intent(&conn)?;
    if redisclient::connectivity_relevant_diff(&old, &conn) || secret_changed {
        redisclient::invalidate_session_for(&conn_id);
        // Reset the VISIBLE state no matter what it was. A green dot is a
        // verdict on old settings; a red dot is a verdict from an old failed
        // attempt — both are stale the moment the connection parameters change,
        // so everything lands back on "disconnected". The sidebar listens for
        // this event and flips the dot / closes the workspace.
        let _ = app.emit(
            "connection-state",
            crate::types::ConnectionStateEvent {
                id: conn_id.clone(),
                status: "disconnected".to_string(),
                error: None,
            },
        );
    }
    Ok(summary_of(&conn))
}

/// Reveal a stored password for the edit dialog's "show" button.
///
/// Deliberately its own command rather than a field on `get_config`: this is the
/// only place the plaintext crosses into the UI, and only when the user asks.
#[tauri::command]
pub async fn reveal_connection_password(conn_id: String) -> Result<Option<String>, String> {
    redisclient::reveal_acl_password(&conn_id)
}

#[tauri::command]
pub async fn clone_connection(conn_id: String) -> Result<ConnectionSummary, String> {
    // Hydrated load so the clone carries the source's credentials; save_config
    // then persists them under the new id.
    let mut cfg = redisclient::load_config()?;
    let mut cloned = cfg
        .connections
        .iter()
        .find(|c| c.id.as_deref() == Some(conn_id.as_str()))
        .cloned()
        .ok_or("Connection not found")?;
    cloned.id = Some(uuid::Uuid::new_v4().to_string());
    cloned.name = format!("{} (copy)", clone_name(&cloned));
    cfg.connections.push(cloned.clone());
    redisclient::save_config(&cfg)?;
    // New id — no live session exists for it, nothing to drop.
    Ok(summary_of(&cloned))
}

fn clone_name(conn: &crate::types::Connection) -> String {
    if conn.name.is_empty() {
        format!("{}:{}", conn.host, conn.port)
    } else {
        conn.name.clone()
    }
}

#[tauri::command]
pub async fn delete_connection(conn_id: String) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_meta()?;
    cfg.connections
        .retain(|c| c.id.as_deref() != Some(conn_id.as_str()));
    redisclient::save_config_meta(&cfg)?;
    redisclient::invalidate_session_for(&conn_id);
    // Clean up any stored credentials for the deleted connection.
    redisclient::delete_connection_secrets(std::slice::from_ref(&conn_id));
    Ok(serde_json::json!({ "ok": true }))
}

/// Set just the group of a connection (used by drag-and-drop in the sidebar).
/// Only touches the group field, never other fields or secrets.
#[tauri::command]
pub fn set_connection_group(conn_id: String, group: Option<String>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_meta()?;
    let conn = cfg
        .connections
        .iter_mut()
        .find(|c| c.id.as_deref() == Some(conn_id.as_str()))
        .ok_or("Connection not found")?;
    conn.group = group;
    redisclient::save_config_meta(&cfg)?;
    // Group is cosmetic; the session stays up.
    Ok(serde_json::json!({ "ok": true }))
}

/// Rename a connection group.
///
/// A group is not an entity — it is just the `group` string carried by each
/// connection — so renaming is a bulk rewrite of that field, saved exactly once.
///
/// `old_name` is matched verbatim and deliberately never trimmed: the sidebar
/// passes the stored string straight through.
///
/// Note: `ConfigFile::connection_groups` is a separate, structured group
/// definition that the UI does not use; it is intentionally left untouched.
#[tauri::command]
pub async fn rename_connection_group(
    old_name: String,
    new_name: String,
) -> Result<serde_json::Value, String> {
    // Trim the NEW name only. Untrimmed, it would be unmatchable from the UI.
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("Group name cannot be empty".to_string());
    }
    // No-op rename: nothing to write.
    if new_name == old_name {
        return Ok(serde_json::json!({ "ok": true, "renamed": 0 }));
    }

    let mut cfg = redisclient::load_config_meta()?;

    // One pass answers both questions. A connection still carrying `old_name` can
    // never also carry `new_name`, so the two arms cannot both fire on one row.
    let mut renamed = 0usize;
    let mut conflict = false;
    for c in cfg.connections.iter() {
        match c.group.as_deref() {
            Some(g) if g == old_name.as_str() => renamed += 1,
            Some(g) if g == new_name.as_str() => conflict = true,
            _ => {}
        }
    }
    if renamed == 0 {
        // The group is gone (renamed or emptied elsewhere). Nothing to persist, and
        // reporting a name clash here would blame the wrong thing.
        return Ok(serde_json::json!({ "ok": true, "renamed": 0 }));
    }
    if conflict {
        return Err(format!("Group \"{new_name}\" already exists"));
    }

    for conn in cfg.connections.iter_mut() {
        if conn.group.as_deref() == Some(old_name.as_str()) {
            conn.group = Some(new_name.clone());
        }
    }

    redisclient::save_config_meta(&cfg)?;
    // A rename never touches how connections connect; sessions stay up.
    Ok(serde_json::json!({ "ok": true, "renamed": renamed }))
}

/// Delete a connection group together with every connection in it, including the
/// credentials those connections hold.
///
/// The ordering is the safety mechanism (there is no transaction here):
///   load -> collect ids -> retain -> save -> invalidate -> clear credentials
/// The config write runs before any credential deletion, so a failed write leaves
/// both stores untouched — all-or-nothing from the user's view.
///
/// Note: this does not touch `ConfigFile::connection_groups` (see above).
#[tauri::command]
pub async fn delete_connection_group(group: String) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_meta()?;

    // Collect the ids BEFORE retaining: `retain` destroys the rows the secret
    // keys are derived from (`{id}:acl_password` and friends), and the loader
    // guarantees every connection has one.
    let ids: Vec<String> = cfg
        .connections
        .iter()
        .filter(|c| c.group.as_deref() == Some(group.as_str()))
        .filter_map(|c| c.id.clone())
        .collect();

    if ids.is_empty() {
        return Ok(serde_json::json!({ "ok": true, "deleted": 0 }));
    }

    cfg.connections
        .retain(|c| c.group.as_deref() != Some(group.as_str()));
    redisclient::save_config_meta(&cfg)?;
    // Only the connections that just got deleted have dead sessions.
    for id in &ids {
        redisclient::invalidate_session_for(id);
    }

    // Best-effort, and only once the config is durable.
    redisclient::delete_connection_secrets(&ids);

    Ok(serde_json::json!({ "ok": true, "deleted": ids.len() }))
}

#[tauri::command]
pub async fn test_connection(conn_id: String, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    // Only the explicit "test" action forces a fresh attempt. The passive status
    // refresh behind `get_connection_status` must NOT: it fires concurrently with
    // the panels when a connection is selected, and clearing the cache there
    // punched a hole in the coalescing, costing a second handshake and a second
    // (differently worded) error toast.
    redisclient::clear_session_failure(&conn_id);
    let result = redisclient::test_session(&conn_id).await;
    emit_connection_state(&app, &conn_id, result.is_ok());
    if let Err(e) = result {
        return Err(e);
    }
    Ok(serde_json::json!({ "ok": true }))
}

fn emit_connection_state(app: &tauri::AppHandle, id: &str, ok: bool) {
    let _ = app.emit(
        "connection-state",
        ConnectionStateEvent {
            id: id.to_string(),
            status: if ok { "ok".to_string() } else { "error".to_string() },
            error: if ok { None } else { Some("Connection failed".to_string()) },
        },
    );
}

#[tauri::command]
pub async fn select_database(conn_id: String, db: i64) -> Result<serde_json::Value, String> {
    let s = redisclient::get_session(&conn_id).await?;
    let _ = s.query(db, vec!["PING".to_string()]).await?;
    Ok(serde_json::json!({ "ok": true, "db": db }))
}

#[tauri::command]
pub async fn get_connection_state(conn_id: String) -> Result<serde_json::Value, String> {
    let s = redisclient::get_session(&conn_id).await?;
    let _ = s.query_str(s.conn.db, vec!["PING".to_string()]).await?;
    Ok(serde_json::json!({ "ok": true, "status": "ok" }))
}

/// Drop the cached session for a connection (disconnect). Does not delete the config.
#[tauri::command]
pub fn disconnect_connection(conn_id: String) -> Result<serde_json::Value, String> {
    let _ = redisclient::drop_session(&conn_id);
    Ok(serde_json::json!({ "ok": true }))
}

/// Report whether a connection currently has a live cached session + can reach the
/// server. Returns `{ connected, healthy }`.
#[tauri::command]
pub async fn get_connection_status(conn_id: String) -> Result<serde_json::Value, String> {
    let healthy = redisclient::test_session(&conn_id).await.is_ok();
    Ok(serde_json::json!({ "connected": healthy, "healthy": healthy }))
}
