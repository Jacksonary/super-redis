use crate::commands::util::{session, val_to_i64, val_to_string};
use std::sync::{Mutex, OnceLock};

fn history() -> &'static Mutex<Vec<String>> {
    static H: OnceLock<Mutex<Vec<String>>> = OnceLock::new();
    H.get_or_init(|| Mutex::new(Vec::new()))
}

/// Commands that block the connection and must NOT run on shared connections
/// (they would wedge every subsequent command queued on the same pipe).
fn is_blocking(cmd: &str) -> bool {
    let upper = cmd.to_uppercase();
    matches!(
        upper.as_str(),
        "SUBSCRIBE"
            | "UNSUBSCRIBE"
            | "PSUBSCRIBE"
            | "PUNSUBSCRIBE"
            | "SSUBSCRIBE"
            | "SUNSUBSCRIBE"
            | "MONITOR"
            | "BLPOP"
            | "BRPOP"
            | "BLMOVE"
            | "BRPOPLPUSH"
            | "BZPOPMIN"
            | "BZPOPMAX"
            | "BZMPOP"
            | "BLMPOP"
            | "WAIT"
            | "WAITAOF"
            | "XREAD"
            | "XREADGROUP"
            | "XREADBLOCK"
    )
}

/// Commands that change the current database connection or that are destructive.
/// `SELECT`/`SWAPDB` silently move the shared per-db connection, breaking the
/// per-db isolation the rest of the app relies on.
fn is_forbidden(cmd: &str) -> bool {
    let upper = cmd.to_uppercase();
    matches!(upper.as_str(), "SELECT" | "SWAPDB")
}

/// Commands that are destructive / privileged and should require explicit
/// confirmation in the UI before running.
fn is_dangerous(cmd: &str) -> bool {
    let upper = cmd.to_uppercase();
    [
        // data destruction
        "FLUSHALL", "FLUSHDB", "SWAPDB", "KEYS", "DEBUG", "SHUTDOWN", "RESTORE",
        // key/ACL/config management
        "ACL SETUSER", "ACL DELUSER", "CLIENT KILL", "CLIENT PAUSE", "CLIENT UNPAUSE",
        "CONFIG SET", "CONFIG RESETSTAT", "REPLICAOF", "SLAVEOF", "MIGRATE", "CLUSTER",
        "SCRIPT", "EVAL", "EVALSHA", "FCALL", "FUNCTION", "PUBSUB",
    ]
    .iter()
    .any(|d| upper == *d || upper.starts_with(d))
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
    // Guard against quote-only input that parses to an empty argv.
    if args.is_empty() {
        return Err("无法解析命令，请检查引号是否闭合".to_string());
    }
    if is_blocking(&args[0]) {
        return Err(format!("Blocking command {} requires a dedicated connection; not supported here", args[0]));
    }
    if is_forbidden(&args[0]) {
        return Err(format!("{} 会改变连接或库状态，请在数据库选择器中切换", args[0]));
    }
    let s = session(&conn_id).await?;
    if s.conn.readonly && is_dangerous(&args[0]) {
        return Err(format!("连接为只读模式，禁止执行危险命令 {}", args[0]));
    }
    let v = s.query(db, args).await?;
    push_history(trimmed);
    Ok(serde_json::json!({ "result": val_to_string(&v) }))
}

/// Alias for `run_terminal_command`.
#[tauri::command]
pub async fn run_command(conn_id: String, db: i64, command: String) -> Result<serde_json::Value, String> {
    run_terminal_command(conn_id, db, command).await
}

/// Execute a batch of commands (one per line) and return results aligned to the
/// input length. Skipped/blocked lines produce a placeholder so the caller can
/// map each result back to its command.
#[tauri::command]
pub async fn run_pipeline(conn_id: String, db: i64, commands: Vec<String>) -> Result<Vec<String>, String> {
    let s = session(&conn_id).await?;
    let mut cmds: Vec<Vec<String>> = Vec::new();
    for line in commands.iter() {
        let args = parse_args(line.trim());
        let skip = args.is_empty()
            || is_blocking(&args[0])
            || is_forbidden(&args[0])
            || (s.conn.readonly && is_dangerous(&args[0]));
        if !skip {
            cmds.push(args);
        }
    }
    let results = s.run_cmds(db, cmds).await?;
    let mut i = 0;
    Ok(commands
        .iter()
        .map(|line| {
            let args = parse_args(line.trim());
            if args.is_empty() {
                "(empty)".to_string()
            } else if is_blocking(&args[0]) || is_forbidden(&args[0]) {
                format!("(skipped: {})", args[0])
            } else if s.conn.readonly && is_dangerous(&args[0]) {
                format!("(blocked: readonly, {})", args[0])
            } else {
                let v = results.get(i).cloned().unwrap_or(redis::Value::Nil);
                i += 1;
                val_to_string(&v)
            }
        })
        .collect())
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
