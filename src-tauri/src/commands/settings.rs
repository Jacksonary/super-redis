use crate::redisclient;
use crate::types::AppSettings;

#[tauri::command]
pub fn get_app_settings() -> Result<AppSettings, String> {
    Ok(redisclient::load_settings())
}

#[tauri::command]
pub fn put_app_settings(settings: AppSettings) -> Result<serde_json::Value, String> {
    redisclient::save_settings(&settings)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn get_theme() -> Result<String, String> {
    Ok(redisclient::load_settings().theme)
}

#[tauri::command]
pub fn put_theme(theme: String) -> Result<serde_json::Value, String> {
    let mut s = redisclient::load_settings();
    s.theme = theme;
    redisclient::save_settings(&s)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn set_language(language: String) -> Result<serde_json::Value, String> {
    let mut s = redisclient::load_settings();
    s.language = language;
    redisclient::save_settings(&s)?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn get_zoom() -> Result<u32, String> {
    Ok(redisclient::load_settings().zoom_percent)
}

#[tauri::command]
pub fn put_zoom(zoom: u32) -> Result<serde_json::Value, String> {
    let mut s = redisclient::load_settings();
    s.zoom_percent = zoom;
    redisclient::save_settings(&s)?;
    Ok(serde_json::json!({ "ok": true }))
}
