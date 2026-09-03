use crate::commands::util::{session, val_to_i64, val_to_string};
use std::sync::{Mutex, OnceLock};

fn history() -> &'static Mutex<Vec<String>> {
    static H: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    H.get_or_init(|| Mutex::new(Vec::new()))
}

/// Commands that block the connection and must not run on shared connections.
fn is_blocking(cmd: &str) -> bool {
    let upper = cmd.to_uppercase();
    matches!(
        upper.as_str(),
        "SUBSCRIBE"
            | "UNSUBSCRIBE"
            | "PSUBSCRIBE"
            | "PUNSUBSCRIBE"
            | "MONITOR"
            | "BLPOP"
            | "BRPOP"
            | "BLMOVE"
            | "BRPOPLPUSH"
            | "WAIT"
            | "XREADBLOCK"
            | "XREAD"
    )
}

fn parse_args(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote: Option<char> = None;
    for c in line.chars() {
        if let Some(q) = in_quote {
            if c == q {
                in_quote = None;
            } else {
                cur.push(c);
            }
        } else {
            match c {
                '"' | '\'' => in_quote = Some(c),
                c if c.is_whitespace() => {
                    if !cur.is_empty() {
                        out.push(cur.clone());
                        cur.clear();
                    }
                }
                _ => cur.push(c),
            }
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Execute an arbitrary command string from the terminal, returning its textual
/// result. Blocking commands are refused to avoid wedging the session connection.
#[tauri::command]
pub async fn run_terminal_command(conn_id: String, db: i64, command: String) -> Result<serde_json::Value, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({ "result": "" }));
    }
    let args = parse_args(trimmed);
    if is_blocking(&args[0]) {
        return Err(format!("Blocking command {} requires a dedicated connection; not supported here", args[0]));
    }
    let s = session(&conn_id).await?;
    let v = s.query(db, args).await?;
    push_history(trimmed);
    Ok(serde_json::json!({ "result": val_to_string(&v) }))
}

/// Alias for `run_terminal_command`.
#[tauri::command]
pub async fn run_command(conn_id: String, db: i64, command: String) -> Result<serde_json::Value, String> {
    run_terminal_command(conn_id, db, command).await
}

/// Execute a batch of commands (one per line) and return their results in order.
#[tauri::command]
pub async fn run_pipeline(conn_id: String, db: i64, commands: Vec<String>) -> Result<Vec<String>, String> {
    let s = session(&conn_id).await?;
    let mut cmds: Vec<Vec<String>> = Vec::new();
    for line in commands.iter() {
        let args = parse_args(line.trim());
        if args.is_empty() || is_blocking(&args[0]) {
            continue;
        }
        cmds.push(args);
    }
    let results = s.run_cmds(db, cmds).await?;
    Ok(results.iter().map(val_to_string).collect())
}

#[tauri::command]
pub async fn publish_message(conn_id: String, db: i64, channel: String, message: String) -> Result<serde_json::Value, String> {
    let s = session(&conn_id).await?;
    let v = s.query(db, vec!["PUBLISH".to_string(), channel, message]).await?;
    Ok(serde_json::json!({ "receivers": val_to_i64(&v) }))
}

#[tauri::command]
pub fn get_command_history() -> Result<Vec<String>, String> {
    Ok(history().lock().unwrap().clone())
}

#[tauri::command]
pub fn append_command_history(command: String) -> Result<serde_json::Value, String> {
    push_history(&command);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn clear_command_history() -> Result<serde_json::Value, String> {
    history().lock().unwrap().clear();
    Ok(serde_json::json!({ "ok": true }))
}

fn push_history(command: &str) {
    if command.trim().is_empty() {
        return;
    }
    let mut h = history().lock().unwrap();
    if h.last().map(|s| s.as_str()) == Some(command) {
        return;
    }
    h.push(command.to_string());
    if h.len() > 500 {
        let len = h.len();
        h.drain(..len - 500);
    }
}
