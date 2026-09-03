// Frontend type mirror of the Rust backend contract in `src-tauri/src/types.rs`.

export interface AclConfig {
  enabled: boolean;
  username: string;
  password: string;
}

export interface TlsConfig {
  enabled: boolean;
  caCertFile?: string | null;
  clientCertFile?: string | null;
  clientKeyFile?: string | null;
  keyPassphrase: string;
  skipVerify: boolean;
  serverName?: string | null;
}

export interface ClusterConfig {
  nodes: string[];
  name?: string | null;
}

export interface SentinelConfig {
  masterName: string;
  nodes: string[];
  password: string;
}

export interface SshConfig {
  enabled: boolean;
  host?: string | null;
  port: number;
  username?: string | null;
  password: string;
  privateKeyFile?: string | null;
  remoteHost?: string | null;
  remotePort: number;
}

export interface Connection {
  id?: string;
  name: string;
  color?: string | null;
  group?: string | null;
  host: string;
  port: number;
  db: number;
  mode: string; // standalone | cluster | sentinel
  readonly: boolean;
  timeout_ms: number;
  acl: AclConfig;
  tls: TlsConfig;
  cluster: ClusterConfig;
  sentinel: SentinelConfig;
  ssh: SshConfig;
  startup_commands: string[];
  encoding: string;
}

export interface ConnectionSummary {
  id: string;
  name: string;
  color?: string | null;
  group?: string | null;
  host: string;
  port: number;
  db: number;
  mode: string;
  readonly: boolean;
  tls: boolean;
  status?: string | null;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  color?: string | null;
  order: number;
}

export interface AppSettings {
  theme: string;
  fontFamily: string;
  fontSize: number;
  zoomPercent: number;
  language: string;
  defaultDb: number;
  scanCount: number;
  showSensitive: boolean;
  terminalMaxHistory: number;
}

export interface KeyInfo {
  key: string;
  type: string;
  ttl: number;
  size?: number | null;
  encoding?: string | null;
}

export interface ListKeysResult {
  keys: string[];
  cursor: number;
  is_truncated: boolean;
}

export interface StringValue {
  value: string;
  is_binary: boolean;
}

export interface HashField {
  field: string;
  value: string;
}

export interface HashFieldsResult {
  items: HashField[];
  cursor: number;
  total: number;
}

export interface ListItemsResult {
  items: string[];
  total: number;
}

export interface SetMembersResult {
  members: string[];
  cursor: number;
  total: number;
}

export interface ZSetItem {
  member: string;
  score: number;
}

export interface StreamEntry {
  id: string;
  fields: [string, string][];
}

export interface StreamInfo {
  length: number;
  entries: StreamEntry[];
  groups: { name: string; consumers: number; pending: number; last_delivered_id: string }[];
  consumers: { name: string; pending: number; idle: number }[];
}

export interface SelectedTarget {
  connectionId: string;
  db: number;
}

export interface Task {
  id: string;
  title: string;
  progress: number;
  status: "running" | "done" | "paused" | "cancelled" | "error";
  total?: number;
  done?: number;
  message?: string;
}

export type TaskStatus = Task["status"];
