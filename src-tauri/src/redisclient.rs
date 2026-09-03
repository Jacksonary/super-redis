use crate::types::{
    AppSettings, Connection, ConnectionGroup, ConnectionSummary,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

// ─── Config file model (connections + groups, persisted to config.json) ───────

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ConfigFile {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub connections: Vec<Connection>,
    #[serde(default)]
    pub connection_groups: Vec<ConnectionGroup>,
}

// ─── Config file lock (serializes load / save) ───────────────────────────────

static CONFIG_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
fn config_lock() -> &'static Mutex<()> {
    CONFIG_LOCK.get_or_init(|| Mutex::new(()))
}

// ─── Keyring helpers ─────────────────────────────────────────────────────────

const KEYRING_SERVICE: &str = "super-redis";

fn kr_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| format!("keyring: {e}"))
}

fn kr_store(key: &str, value: &str) -> Result<(), String> {
    kr_entry(key)?
        .set_password(value)
        .map_err(|e| format!("keyring store: {e}"))
}

fn kr_load(key: &str) -> Result<String, String> {
    kr_entry(key)?
        .get_password()
        .map_err(|e| format!("keyring load: {e}"))
}

fn kr_delete(key: &str) {
    if let Ok(e) = kr_entry(key) {
        let _ = e.delete_credential();
    }
}

/// Secret keys, all keyed by connection id.
fn acl_password_key(id: &str) -> String { format!("{id}:acl_password") }
fn tls_passphrase_key(id: &str) -> String { format!("{id}:tls_passphrase") }
fn sentinel_password_key(id: &str) -> String { format!("{id}:sentinel_password") }

// ─── Config path ─────────────────────────────────────────────────────────────

fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("super-redis").join("config.json")
}

fn settings_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("super-redis").join("settings.json")
}

fn ensure_dir(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    Ok(())
}

// ─── Config read / write ─────────────────────────────────────────────────────

fn ensure_id(conn: &mut Connection) {
    if conn.id.is_none() {
        conn.id = Some(uuid::Uuid::new_v4().to_string());
    }
}

/// Resolve secret fields for a connection from the OS keyring.
fn hydrate_secrets(conn: &mut Connection) {
    let id = match &conn.id {
        Some(id) => id.clone(),
        None => return,
    };
    if conn.acl.password.is_empty() {
        if let Ok(p) = kr_load(&acl_password_key(&id)) {
            conn.acl.password = p;
        }
    }
    if conn.tls.key_passphrase.is_empty() {
        if let Ok(p) = kr_load(&tls_passphrase_key(&id)) {
            conn.tls.key_passphrase = p;
        }
    }
    if conn.sentinel.password.is_empty() {
        if let Ok(p) = kr_load(&sentinel_password_key(&id)) {
            conn.sentinel.password = p;
        }
    }
}

/// Persist secret fields to the OS keyring and strip them from the written copy.
fn store_and_strip(conn: &mut Connection) {
    let id = match &conn.id {
        Some(id) => id.clone(),
        None => return,
    };
    if !conn.acl.password.is_empty() {
        let _ = kr_store(&acl_password_key(&id), &conn.acl.password);
        conn.acl.password.clear();
    }
    if !conn.tls.key_passphrase.is_empty() {
        let _ = kr_store(&tls_passphrase_key(&id), &conn.tls.key_passphrase);
        conn.tls.key_passphrase.clear();
    }
    if !conn.sentinel.password.is_empty() {
        let _ = kr_store(&sentinel_password_key(&id), &conn.sentinel.password);
        conn.sentinel.password.clear();
    }
}

fn read_config_file() -> ConfigFile {
    let path = config_path();
    if !path.exists() {
        return ConfigFile::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<ConfigFile>(&s).ok())
        .unwrap_or_default()
}

/// Load the full config file, hydrating any secrets held in the keyring.
pub fn load_config() -> Result<ConfigFile, String> {
    let _guard = config_lock().lock().unwrap();
    let mut cfg = read_config_file();
    for conn in cfg.connections.iter_mut() {
        ensure_id(conn);
        hydrate_secrets(conn);
    }
    Ok(cfg)
}

/// Load config and assign ids to any connections that lack one, persisting back.
pub fn load_config_with_ids() -> Result<ConfigFile, String> {
    let _guard = config_lock().lock().unwrap();
    let mut cfg = read_config_file();
    let mut needs_save = false;
    for conn in cfg.connections.iter_mut() {
        if conn.id.is_none() {
            ensure_id(conn);
            needs_save = true;
        }
    }
    if needs_save {
        write_config_file(&cfg)?;
    }
    Ok(cfg)
}

/// Save the config file, moving secrets into the keyring first.
pub fn save_config(cfg: &ConfigFile) -> Result<(), String> {
    let _guard = config_lock().lock().unwrap();
    let mut copy = cfg.clone();
    for conn in copy.connections.iter_mut() {
        ensure_id(conn);
        store_and_strip(conn);
    }
    write_config_file(&copy)
}

fn write_config_file(cfg: &ConfigFile) -> Result<(), String> {
    let path = config_path();
    ensure_dir(&path)?;
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(())
}

/// Convenience: get one connection by id (with secrets hydrated).
pub fn get_connection(conn_id: &str) -> Result<Connection, String> {
    let cfg = load_config()?;
    cfg.connections
        .into_iter()
        .find(|c| c.id.as_deref() == Some(conn_id))
        .ok_or_else(|| "Connection not found".to_string())
}

/// Build frontend-facing connection summaries (no credentials).
pub fn list_connection_summaries() -> Result<Vec<ConnectionSummary>, String> {
    let cfg = load_config()?;
    Ok(cfg
        .connections
        .iter()
        .map(|c| ConnectionSummary {
            id: c.id.clone().unwrap_or_default(),
            name: if c.name.is_empty() {
                format!("{}:{}", c.host, c.port)
            } else {
                c.name.clone()
            },
            color: c.color.clone(),
            group: c.group.clone(),
            host: c.host.clone(),
            port: c.port,
            db: c.db,
            mode: c.mode.clone(),
            readonly: c.readonly,
            tls: c.tls.enabled,
            status: None,
        })
        .collect())
}

pub fn display_name(conn: &Connection) -> String {
    if conn.name.is_empty() {
        format!("{}:{}", conn.host, conn.port)
    } else {
        conn.name.clone()
    }
}

// ─── App settings ────────────────────────────────────────────────────────────

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if !path.exists() {
        return AppSettings::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    ensure_dir(&path)?;
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}

// ─── Session (live Redis connection) ─────────────────────────────────────────
//
// Each Session is pinned to one Connection config. For standalone/sentinel we keep
// one `MultiplexedConnection` per database index, each opened with `db` baked into
// its ConnectionInfo so SELECT is applied during handshake — this avoids the
// interleaved-SELECT hazard that plain multiplexed connections have. For cluster we
// keep a single `ClusterConnection` (db 0 only).

pub enum SessionInner {
    Single(tokio::sync::Mutex<HashMap<i64, redis::aio::MultiplexedConnection>>),
    Cluster(Mutex<Option<redis::cluster_async::ClusterConnection>>),
}

pub struct Session {
    pub conn: Connection,
    pub inner: SessionInner,
}

/// Build a connection URL for a standalone/sentinel connection at a given db.
fn single_url(conn: &Connection, db: i64) -> String {
    let scheme = if conn.tls.enabled { "rediss" } else { "redis" };
    let creds = if conn.acl.enabled && !conn.acl.password.is_empty() {
        let user = urlencoding::encode(&conn.acl.username).into_owned();
        let pass = urlencoding::encode(&conn.acl.password).into_owned();
        if conn.acl.username.is_empty() || conn.acl.username == "default" {
            format!(":{pass}@")
        } else {
            format!("{user}:{pass}@")
        }
    } else {
        String::new()
    };
    format!("{scheme}://{creds}{}:{}/{}", conn.host, conn.port, db)
}

async fn open_single(conn: &Connection, db: i64) -> Result<redis::aio::MultiplexedConnection, String> {
    let url = single_url(conn, db);
    let client = redis::Client::open(url.as_str()).map_err(|e| format!("redis connect: {e}"))?;
    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| format!("redis connect: {e}"))
}

/// Resolve the sentinel master for a connection using redis-rs Sentinel (sync).
fn value_to_string(v: &redis::Value) -> String {
    match v {
        redis::Value::BulkString(b) => String::from_utf8_lossy(b).into_owned(),
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Int(i) => i.to_string(),
        _ => format!("{v:?}"),
    }
}

fn split_host_port(s: &str) -> Result<(String, u16), String> {
    let (h, p) = s.rsplit_once(':').ok_or_else(|| format!("无效的 host:port: {s}"))?;
    let port = p.parse::<u16>().map_err(|e| format!("无效端口: {e}"))?;
    Ok((h.to_string(), port))
}

/// Resolve the sentinel master (host, port) by querying the first sentinel node
/// with `SENTINEL get-master-addr-by-name`. Avoids the more heavyweight
/// `redis::sentinel::SentinelClientBuilder` API.
async fn resolve_sentinel(conn: &Connection) -> Result<(String, u16), String> {
    if conn.sentinel.nodes.is_empty() {
        return Err("SENTINEL master nodes not configured".to_string());
    }
    let node = &conn.sentinel.nodes[0];
    let (host, port) = split_host_port(node)?;
    let scheme = if conn.tls.enabled { "rediss" } else { "redis" };
    let url = format!("{scheme}://{host}:{port}");
    let client = redis::Client::open(url.as_str()).map_err(|e| format!("sentinel: {e}"))?;
    let mut con = client
        .get_multiplexed_async_connection()
        .await
        .map_err(|e| format!("sentinel: {e}"))?;
    let mut cmd = redis::Cmd::new();
    cmd.arg("SENTINEL")
        .arg("get-master-addr-by-name")
        .arg(&conn.sentinel.master_name);
    let v: redis::Value = cmd
        .query_async(&mut con)
        .await
        .map_err(|e| format!("sentinel: {e}"))?;
    match v {
        redis::Value::Array(arr) if arr.len() >= 2 => {
            let host = value_to_string(&arr[0]);
            let port = value_to_string(&arr[1]).parse::<u16>().unwrap_or(6379);
            Ok((host, port))
        }
        _ => Err("SENTINEL master not found".to_string()),
    }
}

impl Session {
    /// Open a session eager-validating the primary connection.
    pub async fn open(conn: Connection) -> Result<Arc<Session>, String> {
        match conn.mode.as_str() {
            "cluster" => {
                let cluster = open_cluster(&conn).await?;
                Ok(Arc::new(Session {
                    inner: SessionInner::Cluster(Mutex::new(Some(cluster))),
                    conn,
                }))
            }
            "sentinel" => {
                let master = resolve_sentinel(&conn).await?;
                // Build a standalone connection to the resolved master.
                let mut standalone = conn.clone();
                standalone.host = master.0.clone();
                standalone.port = master.1;
                let url = single_url(&standalone, conn.db);
                let client = redis::Client::open(url.as_str())
                    .map_err(|e| format!("redis connect: {e}"))?;
                let primary = client
                    .get_multiplexed_async_connection()
                    .await
                    .map_err(|e| format!("redis connect: {e}"))?;
                let mut map = HashMap::new();
                map.insert(conn.db, primary);
                Ok(Arc::new(Session {
                    inner: SessionInner::Single(tokio::sync::Mutex::new(map)),
                    conn,
                }))
            }
            _ => {
                let primary = open_single(&conn, conn.db).await?;
                let mut map = HashMap::new();
                map.insert(conn.db, primary);
                Ok(Arc::new(Session {
                    inner: SessionInner::Single(tokio::sync::Mutex::new(map)),
                    conn,
                }))
            }
        }
    }

    /// Get (or lazily open) the multiplexed connection for a database index.
    async fn single_conn(&self, db: i64) -> Result<redis::aio::MultiplexedConnection, String> {
        if let SessionInner::Single(map) = &self.inner {
            let mut guard = map.lock().await;
            if let Some(c) = guard.get(&db) {
                return Ok(c.clone());
            }
            let c = open_single(&self.conn, db).await?;
            guard.insert(db, c.clone());
            Ok(c)
        } else {
            // Cluster connections execute commands via `query`, not `single_conn`.
            Err("cluster 连接通过 query 执行, 不支持 single_conn".to_string())
        }
    }

    async fn cluster_conn(&self) -> Result<redis::cluster_async::ClusterConnection, String> {
        if let SessionInner::Cluster(slot) = &self.inner {
            let guard = slot.lock().unwrap();
            guard
                .clone()
                .ok_or_else(|| "cluster connection not established".to_string())
        } else {
            Err("not a cluster session".to_string())
        }
    }

    /// Execute a raw command (built from string args) and return the raw `Value`.
    ///
    /// Redis accepts bulk-string arguments for commands that expect integers, so
    /// passing `String` args is sufficient. For `Cluster`, the database index is
    /// ignored (cluster uses db 0).
    pub async fn query(&self, db: i64, args: Vec<String>) -> Result<redis::Value, String> {
        let mut cmd = redis::Cmd::new();
        for a in args {
            cmd.arg(a);
        }
        match &self.inner {
            SessionInner::Single(_) => {
                let mut c = self.single_conn(db).await?;
                cmd.query_async::<redis::Value>(&mut c)
                    .await
                    .map_err(|e| format_redis_error(e))
            }
            SessionInner::Cluster(_) => {
                let mut c = self.cluster_conn().await?;
                cmd.query_async::<redis::Value>(&mut c)
                    .await
                    .map_err(|e| format_redis_error(e))
            }
        }
    }

    /// Alias of `query` kept for call sites that build from strings.
    pub async fn query_str(&self, db: i64, args: Vec<String>) -> Result<redis::Value, String> {
        self.query(db, args).await
    }

    /// Run a batch of commands through a single pipeline, returning one raw value
    /// per command. Used to cheaply fill value types / metadata for a key page in
    /// one round trip.
    pub async fn run_cmds(&self, db: i64, cmds: Vec<Vec<String>>) -> Result<Vec<redis::Value>, String> {
        if cmds.is_empty() {
            return Ok(Vec::new());
        }
        let mut pipe = redis::pipe();
        for c in cmds {
            let mut cmd = redis::Cmd::new();
            for a in c {
                cmd.arg(a);
            }
            pipe.add_command(cmd);
        }
        match &self.inner {
            SessionInner::Single(_) => {
                let mut conn = self.single_conn(db).await?;
                pipe.query_async::<Vec<redis::Value>>(&mut conn)
                    .await
                    .map_err(|e| format_redis_error(e))
            }
            SessionInner::Cluster(_) => {
                let mut conn = self.cluster_conn().await?;
                pipe.query_async::<Vec<redis::Value>>(&mut conn)
                    .await
                    .map_err(|e| format_redis_error(e))
            }
        }
    }
}

async fn open_cluster(conn: &Connection) -> Result<redis::cluster_async::ClusterConnection, String> {
    if conn.cluster.nodes.is_empty() {
        return Err("CLUSTER nodes not configured".to_string());
    }
    let scheme = if conn.tls.enabled { "rediss" } else { "redis" };
    let urls: Vec<String> = conn.cluster.nodes.iter().map(|n| format!("{scheme}://{n}")).collect();
    if urls.is_empty() {
        return Err("CLUSTER: no valid nodes".to_string());
    }
    let mut builder = redis::cluster::ClusterClientBuilder::new(urls);
    if conn.acl.enabled && !conn.acl.username.is_empty() {
        builder = builder.username(conn.acl.username.clone());
    }
    if conn.acl.enabled && !conn.acl.password.is_empty() {
        builder = builder.password(conn.acl.password.clone());
    }
    let client = builder
        .build()
        .map_err(|e| format!("cluster: {e}"))?;
    client
        .get_async_connection()
        .await
        .map_err(|e| format!("cluster connect: {e}"))
}

fn format_redis_error(e: redis::RedisError) -> String {
    // `redis::ErrorKind` variant names differ across releases; match on the
    // rendered message instead to stay portable.
    let s = e.to_string();
    if s.contains("WRONGPASS") || s.contains("NOAUTH") || s.to_lowercase().contains("auth") {
        "认证失败: 请检查用户名/密码".to_string()
    } else if s.to_lowercase().contains("connection refused")
        || s.contains("tcp connect")
        || s.contains("failed to be resolved")
    {
        "连接失败, 请检查主机/端口/网络".to_string()
    } else {
        format!("redis: {s}")
    }
}

// ─── Session cache ───────────────────────────────────────────────────────────

static SESSION_CACHE: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
fn session_cache() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Get (or open+cache) a live session for a connection id.
pub async fn get_session(conn_id: &str) -> Result<Arc<Session>, String> {
    {
        let cache = session_cache().lock().unwrap();
        if let Some(s) = cache.get(conn_id) {
            return Ok(s.clone());
        }
    }
    let conn = get_connection(conn_id)?;
    let session = Session::open(conn).await?;
    session_cache()
        .lock()
        .unwrap()
        .insert(conn_id.to_string(), session.clone());
    Ok(session)
}

/// Drop cached sessions. Call after the user edits a connection so the next
/// request reconnects with fresh credentials/settings.
pub fn invalidate_session_cache() {
    session_cache().lock().unwrap().clear();
}

/// Delete all keyring secrets held for a connection id.
pub fn delete_connection_secrets(conn_id: &str) {
    kr_delete(&acl_password_key(conn_id));
    kr_delete(&tls_passphrase_key(conn_id));
    kr_delete(&sentinel_password_key(conn_id));
}

/// Establish a session and validate it with a PING. Used by `test_connection`.
pub async fn test_session(conn_id: &str) -> Result<(), String> {
    let s = get_session(conn_id).await?;
    let _ = s
        .query_str(s.conn.db, vec!["PING".to_string()])
        .await?;
    Ok(())
}
