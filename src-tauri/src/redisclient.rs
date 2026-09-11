use crate::secrets::{self, SecretMap};
use crate::types::{
    AppSettings, Connection, ConnectionGroup, ConnectionSummary,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use redis::{Client, ClientTlsConfig, ConnectionInfo, TlsCertificates};

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

// ─── Secret keys ─────────────────────────────────────────────────────────────
//
// Credentials live in `crate::secrets` (one encrypted file, one master key in
// the OS keyring). Nothing here talks to the keyring directly.

/// Secret keys, all keyed by connection id.
fn acl_password_key(id: &str) -> String { format!("{id}:acl_password") }
fn tls_passphrase_key(id: &str) -> String { format!("{id}:tls_passphrase") }
fn sentinel_password_key(id: &str) -> String { format!("{id}:sentinel_password") }
fn ssh_password_key(id: &str) -> String { format!("{id}:ssh_password") }

// ─── Config path ─────────────────────────────────────────────────────────────

/// Directory holding `config.json`, `settings.json` and `secrets.enc`.
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("super-redis")
}

fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
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

/// Fill a connection's secret fields from the decrypted credential map.
fn hydrate_secrets(conn: &mut Connection, map: &SecretMap) {
    let id = match &conn.id {
        Some(id) => id.clone(),
        None => return,
    };
    let take = |key: String, field: &mut String| {
        if field.is_empty() {
            if let Some(v) = map.get(&key) {
                *field = v.clone();
            }
        }
    };
    take(acl_password_key(&id), &mut conn.acl.password);
    take(tls_passphrase_key(&id), &mut conn.tls.key_passphrase);
    take(sentinel_password_key(&id), &mut conn.sentinel.password);
    take(ssh_password_key(&id), &mut conn.ssh.password);
}

/// Move a connection's secret fields into the credential map, leaving the
/// connection itself scrubbed so it can be written to `config.json`.
///
/// The caller must have loaded `conn` through [`load_config`], because an empty
/// field is taken to mean "this connection has no such secret" and clears any
/// stored value. That is what makes clearing a password in the edit dialog
/// actually take effect.
fn store_and_strip(conn: &mut Connection, map: &mut SecretMap) {
    let id = match &conn.id {
        Some(id) => id.clone(),
        None => return,
    };
    let mut put = |key: String, field: &mut String| {
        if field.is_empty() {
            map.remove(&key);
        } else {
            map.insert(key, std::mem::take(field));
        }
    };
    put(acl_password_key(&id), &mut conn.acl.password);
    put(tls_passphrase_key(&id), &mut conn.tls.key_passphrase);
    put(sentinel_password_key(&id), &mut conn.sentinel.password);
    put(ssh_password_key(&id), &mut conn.ssh.password);
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

// In-memory cache of the config file exactly as it sits on disk — metadata
// only, never secrets. Credentials are merged in on demand by `load_config`,
// which is what keeps sidebar browsing and group edits off the keyring entirely.
static CONFIG_CACHE: OnceLock<Mutex<Option<ConfigFile>>> = OnceLock::new();
fn config_cache() -> &'static Mutex<Option<ConfigFile>> {
    CONFIG_CACHE.get_or_init(|| Mutex::new(None))
}

/// Load the config WITHOUT credentials.
///
/// Never touches the keyring, so it is the right entry point for anything that
/// only needs names, groups, colors or ordering.
pub fn load_config_meta() -> Result<ConfigFile, String> {
    let _guard = config_lock().lock().unwrap();
    load_meta_locked()
}

/// Caller must hold `config_lock`.
fn load_meta_locked() -> Result<ConfigFile, String> {
    if let Some(cfg) = config_cache().lock().unwrap().as_ref() {
        return Ok(cfg.clone());
    }
    let mut cfg = read_config_file();
    let mut assigned = false;
    for conn in cfg.connections.iter_mut() {
        if conn.id.is_none() {
            ensure_id(conn);
            assigned = true;
        }
    }
    if assigned {
        write_config_file(&cfg)?;
    }
    // Cheap, keyring-free: tells the lazy migration which legacy entries exist.
    let ids: Vec<String> = cfg.connections.iter().filter_map(|c| c.id.clone()).collect();
    secrets::note_connection_ids(&ids);
    *config_cache().lock().unwrap() = Some(cfg.clone());
    Ok(cfg)
}

/// Load the config WITH credentials merged in.
///
/// Needs the master key, so it costs one keyring access per process. Use only
/// where credentials are genuinely required (opening a session, the edit dialog,
/// export, clone) — and note that saving a config loaded any other way would
/// treat its blank secret fields as deletions.
pub fn load_config() -> Result<ConfigFile, String> {
    let _guard = config_lock().lock().unwrap();
    let mut cfg = load_meta_locked()?;
    let map = secrets::get_all()?;
    for conn in cfg.connections.iter_mut() {
        hydrate_secrets(conn, &map);
    }
    Ok(cfg)
}

/// Save config AND credentials. `cfg` must come from [`load_config`].
pub fn save_config(cfg: &ConfigFile) -> Result<(), String> {
    let _guard = config_lock().lock().unwrap();
    let mut copy = cfg.clone();
    let mut map = secrets::get_all()?;
    for conn in copy.connections.iter_mut() {
        ensure_id(conn);
        store_and_strip(conn, &mut map);
    }
    // `cfg` is authoritative, so anything left over belongs to a connection that
    // no longer exists. Drops credentials for deleted connections for free.
    let live: std::collections::HashSet<&str> = copy
        .connections
        .iter()
        .filter_map(|c| c.id.as_deref())
        .collect();
    map.retain(|k, _| live.contains(secrets::owner_id(k)));

    write_config_file(&copy)?;
    secrets::save_all(map)?;
    // Refresh the cache in place rather than clearing it: dropping it would force
    // the next read to decrypt again, which is exactly the round trip we removed.
    *config_cache().lock().unwrap() = Some(copy);
    Ok(())
}

/// Save config metadata only, leaving every stored credential untouched.
///
/// Reads no secrets and writes none, so it never needs the master key. This is
/// the path for renames, grouping, colors and ordering — operations that have no
/// business asking the user to unlock their keychain.
///
/// `cfg` MUST come from [`load_config_meta`]. Its secret fields are written back
/// verbatim, which is a no-op for a metadata copy (they are whatever
/// `config.json` already held) but would write plaintext for a hydrated one.
pub fn save_config_meta(cfg: &ConfigFile) -> Result<(), String> {
    let _guard = config_lock().lock().unwrap();
    let mut copy = cfg.clone();
    for conn in copy.connections.iter_mut() {
        ensure_id(conn);
    }
    write_config_file(&copy)?;
    *config_cache().lock().unwrap() = Some(copy);
    Ok(())
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
    let cfg = load_config_meta()?;
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

/// Build a redis connection URL. For TLS + skip_verify we append the `#insecure`
/// fragment (requires the `tls-rustls-insecure` feature), which redis-rs parses
/// into an `insecure` TLS connection.
/// Whether a username needs to be sent at all.
///
/// Redis 6+ authenticates as its implicit `default` user when none is given, so
/// naming it explicitly is a no-op. Older configs have it written into
/// `config.json`; treating it as unset keeps standalone and cluster consistent.
fn has_explicit_username(conn: &Connection) -> bool {
    !conn.acl.username.is_empty() && conn.acl.username != "default"
}

fn build_url(conn: &Connection, host: &str, port: u16, db: i64, use_acl: bool) -> String {
    let scheme = if conn.tls.enabled { "rediss" } else { "redis" };
    let creds = if use_acl && !conn.acl.password.is_empty() {
        let user = urlencoding::encode(&conn.acl.username).into_owned();
        let pass = urlencoding::encode(&conn.acl.password).into_owned();
        if !has_explicit_username(conn) {
            format!(":{pass}@")
        } else {
            format!("{user}:{pass}@")
        }
    } else {
        String::new()
    };
    let mut url = format!("{scheme}://{creds}{host}:{port}/{db}");
    if conn.tls.enabled && conn.tls.skip_verify {
        url.push_str("#insecure");
    }
    url
}

/// Build `TlsCertificates` (CA + client cert/key) from configured file paths.
fn build_tls_certs(conn: &Connection) -> Result<Option<TlsCertificates>, String> {
    if !conn.tls.enabled {
        return Ok(None);
    }
    let root_cert = match &conn.tls.ca_cert_file {
        Some(p) => Some(std::fs::read(p).map_err(|e| format!("read CA cert {p}: {e}"))?),
        None => None,
    };
    let client_tls = match (&conn.tls.client_cert_file, &conn.tls.client_key_file) {
        (Some(c), Some(k)) => Some(ClientTlsConfig {
            client_cert: std::fs::read(c).map_err(|e| format!("read client cert {c}: {e}"))?,
            client_key: std::fs::read(k).map_err(|e| format!("read client key {k}: {e}"))?,
        }),
        (None, None) => None,
        _ => return Err("mTLS requires both a client certificate and a client key".to_string()),
    };
    if root_cert.is_none() && client_tls.is_none() {
        return Ok(None);
    }
    Ok(Some(TlsCertificates { client_tls, root_cert }))
}

/// Build a redis `Client` honoring ACL credentials, TLS (CA / mTLS / skip-verify)
/// and the configured `timeout_ms` for connection + per-command response.
fn open_client(conn: &Connection, host: &str, port: u16, db: i64, use_acl: bool) -> Result<Client, String> {
    let url = build_url(conn, host, port, db, use_acl);
    match build_tls_certs(conn)? {
        Some(certs) => {
            let info: ConnectionInfo = url.parse().map_err(|e| format!("tls conn info: {e}"))?;
            Client::build_with_tls(info, certs).map_err(|e| format!("tls client: {e}"))
        }
        None => Client::open(url.as_str()).map_err(|e| format!("redis connect: {e}")),
    }
}

/// Connect a multiplexed connection applying the connection's configured
/// `timeout_ms` for both establishment and per-command response.
async fn open_multiplexed(client: Client, timeout_ms: u64) -> Result<redis::aio::MultiplexedConnection, String> {
    let t = Duration::from_millis(timeout_ms);
    let cfg = redis::AsyncConnectionConfig::new()
        .set_connection_timeout(Some(t))
        .set_response_timeout(Some(t));
    client
        .get_multiplexed_async_connection_with_config(&cfg)
        .await
        .map_err(|e| format!("redis connect: {e}"))
}

async fn open_single(conn: &Connection, db: i64) -> Result<redis::aio::MultiplexedConnection, String> {
    let client = open_client(conn, &conn.host, conn.port, db, true)?;
    open_multiplexed(client, conn.timeout_ms).await
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
    let (h, p) = s.rsplit_once(':').ok_or_else(|| format!("Invalid host:port: {s}"))?;
    let port = p.parse::<u16>().map_err(|e| format!("Invalid port: {e}"))?;
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
    // Authenticate to the sentinel node itself using the sentinel password
    // (a plain AUTH password, not an ACL user).
    let mut sentinel_conn = conn.clone();
    if !conn.sentinel.password.is_empty() {
        sentinel_conn.acl.enabled = true;
        sentinel_conn.acl.username = "".to_string();
        sentinel_conn.acl.password = conn.sentinel.password.clone();
    }
    let client = open_client(&sentinel_conn, &host, port, 0, true)
        .map_err(|e| format!("sentinel: {e}"))?;
    let mut con = open_multiplexed(client, conn.timeout_ms)
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
                let primary = open_single(&standalone, conn.db).await?;
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
            Err("cluster connection uses query, not single_conn".to_string())
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
    let urls: Vec<String> = conn
        .cluster
        .nodes
        .iter()
        .map(|n| {
            let mut u = format!("{scheme}://{n}");
            if conn.tls.enabled && conn.tls.skip_verify {
                u.push_str("#insecure");
            }
            u
        })
        .collect();
    if urls.is_empty() {
        return Err("CLUSTER: no valid nodes".to_string());
    }
    let mut builder = redis::cluster::ClusterClientBuilder::new(urls);
    if has_explicit_username(conn) {
        builder = builder.username(conn.acl.username.clone());
    }
    if !conn.acl.password.is_empty() {
        builder = builder.password(conn.acl.password.clone());
    }
    builder = builder.connection_timeout(Duration::from_millis(conn.timeout_ms));
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
        "Auth failed: check username/password".to_string()
    } else if s.to_lowercase().contains("connection refused")
        || s.contains("tcp connect")
        || s.contains("failed to be resolved")
    {
        "Connection failed, check host/port/network".to_string()
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
// Serializes opens per connection. Selecting a connection fans out to several
// panels at once; without this each one runs its own TCP+TLS handshake, so a
// dead host produced four identical failures in the same second.
static SESSION_GATES: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();

fn session_gate(conn_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    SESSION_GATES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap()
        .entry(conn_id.to_string())
        .or_default()
        .clone()
}

// Remembers a failed open just long enough to cover the fan-out. The gate alone
// is not enough: the callers queued behind it would each retry the same doomed
// handshake in turn, turning four parallel failures into four serial ones.
static SESSION_FAILURES: OnceLock<Mutex<HashMap<String, (std::time::Instant, String)>>> =
    OnceLock::new();
const FAILURE_TTL: Duration = Duration::from_millis(1500);

fn session_failures() -> &'static Mutex<HashMap<String, (std::time::Instant, String)>> {
    SESSION_FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn recent_failure(conn_id: &str) -> Option<String> {
    let map = session_failures().lock().unwrap();
    map.get(conn_id).and_then(|(at, err)| {
        (at.elapsed() < FAILURE_TTL).then(|| err.clone())
    })
}

/// Forget a cached failure so the next open really retries. Called for actions
/// the user took deliberately, which must never be answered from cache.
pub fn clear_session_failure(conn_id: &str) {
    session_failures().lock().unwrap().remove(conn_id);
}

pub async fn get_session(conn_id: &str) -> Result<Arc<Session>, String> {
    if let Some(s) = session_cache().lock().unwrap().get(conn_id) {
        return Ok(s.clone());
    }
    let gate = session_gate(conn_id);
    let _open = gate.lock().await;
    // Re-check under the gate: whoever held it may have opened the session, or
    // failed and left an error worth reusing.
    if let Some(s) = session_cache().lock().unwrap().get(conn_id) {
        return Ok(s.clone());
    }
    if let Some(err) = recent_failure(conn_id) {
        return Err(err);
    }
    let conn = get_connection(conn_id)?;
    match Session::open(conn).await {
        Ok(session) => {
            session_cache()
                .lock()
                .unwrap()
                .insert(conn_id.to_string(), session.clone());
            clear_session_failure(conn_id);
            Ok(session)
        }
        Err(e) => {
            session_failures()
                .lock()
                .unwrap()
                .insert(conn_id.to_string(), (std::time::Instant::now(), e.clone()));
            Err(e)
        }
    }
}

/// Drop cached sessions. Call after the user edits a connection so the next
/// request reconnects with fresh credentials/settings.
pub fn invalidate_session_cache() {
    session_cache().lock().unwrap().clear();
    session_failures().lock().unwrap().clear();
}

// ─── Credential intent (the write-only password boundary) ────────────────────

/// Apply the credential changes a client asked for, and nothing else.
///
/// An empty `password` means "leave the stored one alone", so this is a no-op —
/// and crucially never touches the master key — unless the user actually typed a
/// new password or asked for the stored one to be cleared. That is what makes
/// renaming a connection cost zero keychain access.
///
/// Only the ACL password is exposed by the UI; TLS, sentinel and SSH secrets are
/// left untouched for the same reason (an empty field is not a deletion).
///
/// Returns whether any credential actually changed, so the caller can decide
/// whether the live session needs to be rebuilt.
pub fn apply_secret_intent(conn: &Connection) -> Result<bool, String> {
    let id = match conn.id.as_deref() {
        Some(id) => id,
        None => return Ok(false),
    };
    let mut changed = false;
    if !conn.acl.password.is_empty() {
        secrets::set_one(&acl_password_key(id), Some(&conn.acl.password))?;
        changed = true;
    } else if conn.acl.clear_password {
        secrets::set_one(&acl_password_key(id), None)?;
        changed = true;
    }
    // No clear-flag for these: the UI does not expose them, so "empty" can only
    // mean "unchanged". They are removed with the connection itself.
    if !conn.tls.key_passphrase.is_empty() {
        secrets::set_one(&tls_passphrase_key(id), Some(&conn.tls.key_passphrase))?;
        changed = true;
    }
    if !conn.sentinel.password.is_empty() {
        secrets::set_one(&sentinel_password_key(id), Some(&conn.sentinel.password))?;
        changed = true;
    }
    if !conn.ssh.password.is_empty() {
        secrets::set_one(&ssh_password_key(id), Some(&conn.ssh.password))?;
        changed = true;
    }
    Ok(changed)
}

/// Whether an edit changes anything the live session was built from.
///
/// Every field a session carries into its TCP/TLS/auth configuration is here;
/// everything purely cosmetic (name, group, color, encoding) is not, so those
/// edits can land without disconnecting an active connection. `readonly` is
/// included because commands read it from the cached session's `conn` copy.
///
/// Credentials are NOT compared here: the secret store is separate, so the old
/// copy has blank password fields. Password changes arrive through
/// [`apply_secret_intent`]'s return value instead.
pub fn connectivity_relevant_diff(old: &Connection, new: &Connection) -> bool {
    old.host != new.host
        || old.port != new.port
        || old.db != new.db
        || old.mode != new.mode
        || old.timeout_ms != new.timeout_ms
        || old.readonly != new.readonly
        // Compare the WIRE MEANING, not the raw string: `""` and `"default"`
        // are the same AUTH (Redis's implicit user), so an edit between them
        // must not reconnect — nothing changed on the wire.
        || has_explicit_username(old) != has_explicit_username(new)
        || old.tls.enabled != new.tls.enabled
        || old.tls.ca_cert_file != new.tls.ca_cert_file
        || old.tls.client_cert_file != new.tls.client_cert_file
        || old.tls.client_key_file != new.tls.client_key_file
        || old.tls.skip_verify != new.tls.skip_verify
        || old.tls.server_name != new.tls.server_name
        || old.cluster.nodes != new.cluster.nodes
        || old.sentinel.master_name != new.sentinel.master_name
        || old.sentinel.nodes != new.sentinel.nodes
        || old.startup_commands != new.startup_commands
        // SSH is not exposed in the UI yet, but a future edit here must rebuild
        // the session like any other transport-level change.
        || old.ssh.enabled != new.ssh.enabled
        || old.ssh.host != new.ssh.host
        || old.ssh.port != new.ssh.port
        || old.ssh.username != new.ssh.username
        || old.ssh.private_key_file != new.ssh.private_key_file
        || old.ssh.remote_host != new.ssh.remote_host
        || old.ssh.remote_port != new.ssh.remote_port
}

/// Drop the live session for one connection, plus any remembered failure, so
/// the next command against it does a fresh handshake with the new settings.
pub fn invalidate_session_for(conn_id: &str) {
    drop_session(conn_id);
    clear_session_failure(conn_id);
}

/// Keep `acl.enabled` truthful in `config.json`.
///
/// It is a derived mirror of "a password exists" and nothing authenticates on it
/// any more, so a stale value is cosmetic rather than a connection failure.
pub fn sync_acl_enabled(conn: &mut Connection) {
    let stored = conn
        .id
        .as_deref()
        .map(|id| secrets::has(&acl_password_key(id)))
        .unwrap_or(false);
    conn.acl.enabled = !conn.acl.password.is_empty() || (stored && !conn.acl.clear_password);
}

/// Blank every secret field and flag which ones exist, for handing a connection
/// list to the UI. Uses the plaintext key index, so it needs no master key.
fn mask_secrets(conn: &mut Connection) {
    let has = conn
        .id
        .as_deref()
        .map(|id| secrets::has(&acl_password_key(id)))
        .unwrap_or(false);
    conn.acl.password.clear();
    conn.tls.key_passphrase.clear();
    conn.sentinel.password.clear();
    conn.ssh.password.clear();
    conn.acl.has_password = has;
}

/// Connections for the UI, with credentials masked rather than revealed.
pub fn list_connections_masked() -> Result<Vec<Connection>, String> {
    let mut cfg = load_config_meta()?;
    for conn in cfg.connections.iter_mut() {
        mask_secrets(conn);
    }
    Ok(cfg.connections)
}

/// The stored ACL password, for the edit dialog's explicit "show" action.
pub fn reveal_acl_password(conn_id: &str) -> Result<Option<String>, String> {
    secrets::get_one(&acl_password_key(conn_id))
}

/// Delete every credential held for the given connection ids.
pub fn delete_connection_secrets(conn_ids: &[String]) {
    // Best-effort: the connections are already gone from config.json, and a
    // leftover entry is inert (nothing can reference it) and gets swept up by
    // the next hydrated save.
    let _ = secrets::remove_for_connections(conn_ids);
}

/// Establish a session and validate it with a PING. Used by `test_connection`.
pub async fn test_session(conn_id: &str) -> Result<(), String> {
    let s = get_session(conn_id).await?;
    let _ = s
        .query_str(s.conn.db, vec!["PING".to_string()])
        .await?;
    Ok(())
}

/// Drop a single cached session (used by "disconnect"). Returns true if one was removed.
pub fn drop_session(conn_id: &str) -> bool {
    session_cache().lock().unwrap().remove(conn_id).is_some()
}


#[cfg(test)]
mod connectivity_tests {
    use super::*;
    use crate::types::{AclConfig, Connection, TlsConfig};

    #[test]
    fn identical_connections_have_no_diff() {
        assert!(!connectivity_relevant_diff(&Connection::default(), &Connection::default()));
    }

    #[test]
    fn cosmetic_fields_alone_do_not_disconnect() {
        let mut a = Connection::default();
        let mut b = Connection::default();
        b.name = "renamed".into();
        b.group = Some("prod".into());
        b.color = Some("red".into());
        b.encoding = "latin1".into();
        assert!(!connectivity_relevant_diff(&a, &b));
    }

    #[test]
    fn empty_to_default_username_is_a_wire_noop() {
        let mut a = Connection::default();
        a.acl.username = String::new();
        let mut b = Connection::default();
        b.acl.username = "default".into();
        assert!(!connectivity_relevant_diff(&a, &b));

        // And the reverse direction, for good measure.
        assert!(!connectivity_relevant_diff(&b, &a));
    }

    #[test]
    fn real_username_change_does_disconnect() {
        let mut a = Connection::default();
        let mut b = Connection::default();
        b.acl.username = "alice".into();
        assert!(connectivity_relevant_diff(&a, &b));
    }

    #[test]
    fn transport_and_auth_fields_do_disconnect() {
        let base = Connection::default();
        let mut cases: Vec<Connection> = Vec::new();

        let mut c = base.clone(); c.host = "other-host".into(); cases.push(c);
        let mut c = base.clone(); c.port = 6380; cases.push(c);
        let mut c = base.clone(); c.db = 3; cases.push(c);
        let mut c = base.clone(); c.readonly = true; cases.push(c);
        let mut c = base.clone(); c.timeout_ms = 500; cases.push(c);
        let mut c = base.clone(); c.mode = "cluster".into(); cases.push(c);
        let mut c = base.clone(); c.tls.enabled = true; cases.push(c);
        let mut c = base.clone(); c.tls.skip_verify = true; cases.push(c);
        let mut c = base.clone(); c.tls.server_name = Some("x".into()); cases.push(c);
        let mut c = base.clone(); c.cluster.nodes.push("10.0.0.1:7000".into()); cases.push(c);
        let mut c = base.clone(); c.sentinel.master_name = "other".into(); cases.push(c);
        let mut c = base.clone(); c.startup_commands.push("SELECT 2".into()); cases.push(c);

        for case in cases {
            assert!(
                connectivity_relevant_diff(&base, &case),
                "expected diff, got none for {case:?}"
            );
        }
        // AclConfig and TlsConfig are fetched to keep the imports honest.
        let _ = (AclConfig::default(), TlsConfig::default());
    }
}
