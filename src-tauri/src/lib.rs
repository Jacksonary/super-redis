use tauri::Manager;

mod commands;
mod redisclient;
mod task_registry;
pub mod types;

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(
            |app, _argv, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            },
        ));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(task_registry::TaskRegistry::default())
        .invoke_handler(tauri::generate_handler![
            // Config & settings
            commands::config::get_config,
            commands::config::put_config,
            commands::config::get_connection_groups,
            commands::config::put_connection_groups,
            commands::settings::get_app_settings,
            commands::settings::put_app_settings,
            commands::settings::get_theme,
            commands::settings::put_theme,
            commands::settings::set_language,
            commands::settings::get_zoom,
            commands::settings::put_zoom,
            // Connections
            commands::connections::list_connections,
            commands::connections::create_connection,
            commands::connections::update_connection,
            commands::connections::clone_connection,
            commands::connections::delete_connection,
            commands::connections::test_connection,
            commands::connections::select_database,
            commands::connections::set_readonly,
            commands::connections::get_connection_state,
            commands::connections::disconnect_connection,
            commands::connections::get_connection_status,
            // Keys
            commands::keys::list_keys,
            commands::keys::scan_keys,
            commands::keys::search_keys,
            commands::keys::get_key_info,
            commands::keys::get_key_count,
            commands::keys::get_db_size,
            commands::keys::delete_keys,
            commands::keys::delete_keys_by_pattern,
            commands::keys::get_search_history,
            // Values
            commands::values::get_value,
            commands::values::get_zset_items,
            commands::values::add_zset_item,
            commands::values::delete_zset_item,
            // Streams
            commands::streams::get_stream_info,
            commands::streams::read_stream_entries,
            commands::streams::add_stream_entry,
            commands::streams::delete_stream_entry,
            commands::streams::create_consumer_group,
            // Monitor / info
            commands::monitor::get_db_count,
            commands::monitor::get_server_info,
            commands::monitor::get_slowlog,
            commands::monitor::clear_slowlog,
            commands::values::set_value,
            commands::values::set_value_with_ttl,
            commands::values::get_key_type,
            commands::values::get_key_ttl,
            commands::values::get_hash_fields,
            commands::values::get_hash_field,
            commands::values::set_hash_field,
            commands::values::delete_hash_field,
            commands::values::get_list_items,
            commands::values::push_list_item,
            commands::values::delete_list_item,
            commands::values::set_list_value,
            commands::values::get_set_items,
            commands::values::add_set_item,
            commands::values::delete_set_item,
            // Key operations
            commands::key_ops::create_key,
            commands::key_ops::rename_key,
            commands::key_ops::copy_key,
            commands::key_ops::move_key,
            commands::key_ops::expire_key,
            commands::key_ops::persist_key,
            commands::key_ops::set_key_expire,
            // Terminal
            commands::terminal::run_terminal_command,
            commands::terminal::run_command,
            commands::terminal::run_pipeline,
            commands::terminal::publish_message,
            commands::terminal::get_command_history,
            commands::terminal::append_command_history,
            commands::terminal::clear_command_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
