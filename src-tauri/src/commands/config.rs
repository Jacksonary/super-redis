use crate::redisclient;
use crate::types::{Connection, ConnectionGroup};

/// Return all saved connections with credentials MASKED — passwords are blanked
/// and `acl.has_password` says whether one is stored. Costs no keychain access;
/// use `reveal_connection_password` for the plaintext.
#[tauri::command]
pub fn get_config() -> Result<Vec<Connection>, String> {
    redisclient::list_connections_masked()
}

/// Replace the full connection list, moving credentials into encrypted storage.
#[tauri::command]
pub fn put_config(connections: Vec<Connection>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config()?;
    cfg.connections = connections;
    redisclient::save_config(&cfg)?;
    redisclient::invalidate_session_cache();
    Ok(serde_json::json!({ "ok": true }))
}

/// Export all connections, INCLUDING secrets (passwords), so an import can fully
/// restore them. Intended for local backup; the JSON contains plaintext secrets.
#[tauri::command]
pub fn export_config() -> Result<String, String> {
    let cfg = redisclient::load_config()?;
    serde_json::to_string_pretty(&cfg.connections)
        .map_err(|e| format!("Failed to serialize config: {e}"))
}

/// Import connections, MERGING with existing ones (not replacing). A connection
/// is skipped if one with the same host:port already exists. Secrets (passwords)
/// from the import are moved into encrypted storage on save.
#[tauri::command]
pub fn import_config(imported: Vec<Connection>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config()?;
    let mut existing_hosts: std::collections::HashSet<(String, u16)> = cfg
        .connections
        .iter()
        .map(|c| (c.host.clone(), c.port))
        .collect();
    let mut added = 0usize;
    let mut skipped = 0usize;
    for mut conn in imported {
        if existing_hosts.contains(&(conn.host.clone(), conn.port)) {
            skipped += 1;
            continue;
        }
        // Fresh id so it doesn't collide with an existing connection's secret keys.
        conn.id = Some(uuid::Uuid::new_v4().to_string());
        existing_hosts.insert((conn.host.clone(), conn.port));
        cfg.connections.push(conn);
        added += 1;
    }
    redisclient::save_config(&cfg)?;
    // Import only ever adds fresh ids; existing sessions stay untouched.
    Ok(serde_json::json!({ "added": added, "skipped": skipped }))
}

#[tauri::command]
pub fn get_connection_groups() -> Result<Vec<ConnectionGroup>, String> {
    Ok(redisclient::load_config_meta()?.connection_groups)
}

#[tauri::command]
pub fn put_connection_groups(groups: Vec<ConnectionGroup>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_meta()?;
    cfg.connection_groups = groups;
    redisclient::save_config_meta(&cfg)?;
    Ok(serde_json::json!({ "ok": true }))
}


