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

#[tauri::command]
pub async fn create_connection(mut conn: crate::types::Connection) -> Result<ConnectionSummary, String> {
    if conn.id.is_none() {
        conn.id = Some(uuid::Uuid::new_v4().to_string());
    }
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connections.push(conn.clone());
    redisclient::save_config(&cfg)?;
    redisclient::invalidate_session_cache();
    Ok(summary_of(&conn))
}

#[tauri::command]
pub async fn update_connection(conn: crate::types::Connection) -> Result<ConnectionSummary, String> {
    let conn_id = conn.id.clone().ok_or("Connection id missing")?;
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connections
        .iter_mut()
        .find(|c| c.id.as_deref() == Some(conn_id.as_str()))
        .map(|c| *c = conn.clone())
        .ok_or("Connection not found")?;
    redisclient::save_config(&cfg)?;
    redisclient::invalidate_session_cache();
    Ok(summary_of(&conn))
}

#[tauri::command]
pub async fn clone_connection(conn_id: String) -> Result<ConnectionSummary, String> {
    let mut cfg = redisclient::load_config_with_ids()?;
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
    redisclient::invalidate_session_cache();
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
    let mut cfg = redisclient::load_config_with_ids()?;
    cfg.connections
        .retain(|c| c.id.as_deref() != Some(conn_id.as_str()));
    redisclient::save_config(&cfg)?;
    redisclient::invalidate_session_cache();
    // Clean up any keyring secrets for the deleted connection.
    redisclient::delete_connection_secrets(&conn_id);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn test_connection(conn_id: String, app: tauri::AppHandle) -> Result<serde_json::Value, String> {
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
pub async fn set_readonly(conn_id: String, readonly: bool) -> Result<serde_json::Value, String> {
    let s = redisclient::get_session(&conn_id).await?;
    let cmd = if readonly { "READONLY" } else { "READWRITE" };
    let _ = s.query_str(s.conn.db, vec![cmd.to_string()]).await?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub async fn get_connection_state(conn_id: String) -> Result<serde_json::Value, String> {
    let s = redisclient::get_session(&conn_id).await?;
    let _ = s.query_str(s.conn.db, vec!["PING".to_string()]).await?;
    Ok(serde_json::json!({ "ok": true, "status": "ok" }))
}
