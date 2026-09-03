use serde::{Deserialize, Serialize};

// ─── TLS / ACL / Cluster / Sentinel / SSH config ─────────────────────────────

/// TLS configuration for a connection. Certificates are referenced by file path;
/// the content never enters `config.json`. The key passphrase is sensitive and
/// stored in the OS keyring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TlsConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub ca_cert_file: Option<String>,
    #[serde(default)]
    pub client_cert_file: Option<String>,
    #[serde(default)]
    pub client_key_file: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub key_passphrase: String,
    #[serde(default)]
    pub skip_verify: bool,
    #[serde(default)]
    pub server_name: Option<String>,
}

impl Default for TlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            ca_cert_file: None,
            client_cert_file: None,
            client_key_file: None,
            key_passphrase: String::new(),
            skip_verify: false,
            server_name: None,
        }
    }
}

/// Redis 6.0+ ACL user/password.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AclConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String, // sensitive → keyring
}

impl Default for AclConfig {
    fn default() -> Self {
        Self { enabled: false, username: "default".to_string(), password: String::new() }
    }
}

/// Redis Cluster nodes (host:port bootstrap list).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterConfig {
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default)]
    pub name: Option<String>,
}

impl Default for ClusterConfig {
    fn default() -> Self {
        Self { nodes: Vec::new(), name: None }
    }
}

/// Redis Sentinel master discovery configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentinelConfig {
    #[serde(default = "default_sentinel_master")]
    pub master_name: String,
    #[serde(default)]
    pub nodes: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String, // sensitive → keyring
}

fn default_sentinel_master() -> String {
    "mymaster".to_string()
}

impl Default for SentinelConfig {
    fn default() -> Self {
        Self { master_name: default_sentinel_master(), nodes: Vec::new(), password: String::new() }
    }
}

/// SSH tunnel placeholder (deferred to P3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub password: String,
    #[serde(default)]
    pub private_key_file: Option<String>,
    #[serde(default)]
    pub remote_host: Option<String>,
    #[serde(default = "default_redis_port")]
    pub remote_port: u16,
}

fn default_ssh_port() -> u16 { 22 }
fn default_redis_port() -> u16 { 6379 }

impl Default for SshConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: None,
            port: default_ssh_port(),
            username: None,
            password: String::new(),
            private_key_file: None,
            remote_host: None,
            remote_port: default_redis_port(),
        }
    }
}

// ─── Connection / Group / Settings ───────────────────────────────────────────

/// One Redis connection entry. Non-sensitive fields live in `config.json`;
/// passwords live in the OS keyring keyed by `id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    pub host: String,
    #[serde(default = "default_redis_port")]
    pub port: u16,
    #[serde(default)]
    pub db: i64,
    #[serde(default = "default_mode")]
    pub mode: String, // standalone | cluster | sentinel
    #[serde(default)]
    pub readonly: bool,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub acl: AclConfig,
    #[serde(default)]
    pub tls: TlsConfig,
    #[serde(default)]
    pub cluster: ClusterConfig,
    #[serde(default)]
    pub sentinel: SentinelConfig,
    #[serde(default)]
    pub ssh: SshConfig,
    #[serde(default)]
    pub startup_commands: Vec<String>,
    #[serde(default = "default_encoding")]
    pub encoding: String,
}

fn default_mode() -> String { "standalone".to_string() }
fn default_timeout_ms() -> u64 { 10_000 }
fn default_encoding() -> String { "utf-8".to_string() }

impl Default for Connection {
    fn default() -> Self {
        Self {
            id: None,
            name: String::new(),
            color: None,
            group: None,
            host: "127.0.0.1".to_string(),
            port: default_redis_port(),
            db: 0,
            mode: default_mode(),
            readonly: false,
            timeout_ms: default_timeout_ms(),
            acl: AclConfig::default(),
            tls: TlsConfig::default(),
            cluster: ClusterConfig::default(),
            sentinel: SentinelConfig::default(),
            ssh: SshConfig::default(),
            startup_commands: Vec::new(),
            encoding: default_encoding(),
        }
    }
}

/// Frontend-facing connection summary (no credentials).
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub db: i64,
    pub mode: String,
    pub readonly: bool,
    pub tls: bool,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub order: i32,
}

/// App-level settings persisted to `settings.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String, // light | dark | system
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_zoom")]
    pub zoom_percent: u32,
    #[serde(default = "default_language")]
    pub language: String, // zh-CN | en-US
    #[serde(default)]
    pub default_db: i64,
    #[serde(default = "default_scan_count")]
    pub scan_count: u64,
    #[serde(default)]
    pub show_sensitive: bool,
    #[serde(default = "default_terminal_history")]
    pub terminal_max_history: u32,
}

fn default_theme() -> String { "light".to_string() }
fn default_font() -> String { "SF Mono".to_string() }
fn default_font_size() -> u32 { 14 }
fn default_zoom() -> u32 { 100 }
fn default_language() -> String { "en".to_string() }
fn default_scan_count() -> u64 { 1000 }
fn default_terminal_history() -> u32 { 500 }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            font_family: default_font(),
            font_size: default_font_size(),
            zoom_percent: default_zoom(),
            language: default_language(),
            default_db: 0,
            scan_count: default_scan_count(),
            show_sensitive: false,
            terminal_max_history: default_terminal_history(),
        }
    }
}

// ─── Key / value result structures ───────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct KeyInfo {
    pub key: String,
    #[serde(rename = "type")]
    pub value_type: String,
    pub ttl: i64,           // -1 = no expire, -2 = no key
    pub size: Option<i64>,
    pub encoding: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListKeysResult {
    pub keys: Vec<String>,
    pub cursor: u64,
    pub is_truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct StringValue {
    pub value: String,
    pub is_binary: bool,
}

#[derive(Debug, Serialize)]
pub struct HashField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct HashFieldsResult {
    pub items: Vec<HashField>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct ListItemsResult {
    pub items: Vec<String>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct SetMembersResult {
    pub members: Vec<String>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct ZSetItem {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Serialize)]
pub struct ZSetItemsResult {
    pub items: Vec<ZSetItem>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct StreamEntry {
    pub id: String,
    pub fields: Vec<(String, String)>,
}

#[derive(Debug, Serialize)]
pub struct StreamGroup {
    pub name: String,
    pub consumers: i64,
    pub pending: i64,
    pub last_delivered_id: String,
}

#[derive(Debug, Serialize)]
pub struct StreamConsumer {
    pub name: String,
    pub pending: i64,
    pub idle: i64,
}

#[derive(Debug, Serialize)]
pub struct StreamInfo {
    pub length: i64,
    pub entries: Vec<StreamEntry>,
    pub groups: Vec<StreamGroup>,
    pub consumers: Vec<StreamConsumer>,
}

// ─── Event payloads (emit to frontend) ───────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TaskProgress {
    pub task_id: String,
    pub progress: u8,
    pub total: Option<u64>,
    pub done: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskStateEvent {
    pub task_id: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonitorEvent {
    pub ts: u64,
    pub db: i64,
    pub client: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PubSubMessage {
    pub channel: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStateEvent {
    pub id: String,
    pub status: String,
    pub error: Option<String>,
}
