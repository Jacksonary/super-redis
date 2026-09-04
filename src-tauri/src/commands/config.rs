use crate::redisclient;
use crate::types::{Connection, ConnectionGroup};

/// Strip secrets (passwords) from a connection so it can be exported safely.
/// Passwords live in the OS keyring; they are never written to config.json and
/// must not be included in an export. The user re-enters them on import.
fn strip_secrets(mut c: Connection) -> Connection {
    c.acl.password.clear();
    c.tls.key_passphrase.clear();
    c.sentinel.password.clear();
    c.ssh.password.clear();
    c
}

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

/// Export all connections with secrets stripped, as a JSON string. The user can
/// copy/save this to share a config; passwords are excluded and must be re-entered.
#[tauri::command]
pub fn export_config() -> Result<String, String> {
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connections = cfg.connections.into_iter().map(strip_secrets).collect();
    serde_json::to_string_pretty(&cfg.connections)
        .map_err(|e| format!("Failed to serialize config: {e}"))
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
