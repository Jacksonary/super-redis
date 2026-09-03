use crate::redisclient;
use crate::types::{Connection, ConnectionGroup};

/// Return all saved connections (with secrets hydrated from the keyring).
#[tauri::command]
pub fn get_config() -> Result<Vec<Connection>, String> {
    Ok(redisclient::load_config_with_ids()?.connections)
}

/// Replace the full connection list, moving secrets into the keyring.
#[tauri::command]
pub fn put_config(connections: Vec<Connection>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connections = connections;
    redisclient::save_config(&cfg)?;
    redisclient::invalidate_session_cache();
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn get_connection_groups() -> Result<Vec<ConnectionGroup>, String> {
    Ok(redisclient::load_config_with_ids()?.connection_groups)
}

#[tauri::command]
pub fn put_connection_groups(groups: Vec<ConnectionGroup>) -> Result<serde_json::Value, String> {
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connection_groups = groups;
    redisclient::save_config(&cfg)?;
    Ok(serde_json::json!({ "ok": true }))
}
