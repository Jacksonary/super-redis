import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  Connection,
  ConnectionGroup,
  ConnectionSummary,
  HashField,
  HashFieldsResult,
  KeyInfo,
  ListItemsResult,
  ListKeysResult,
  SetMembersResult,
  StringValue,
} from "./types";

export const api = {
  // ─── Config / settings ────────────────────────────────────────────────
  getConfig(): Promise<Connection[]> {
    return invoke("get_config");
  },
  putConfig(connections: Connection[]): Promise<{ ok: boolean }> {
    return invoke("put_config", { connections });
  },
  getConnectionGroups(): Promise<ConnectionGroup[]> {
    return invoke("get_connection_groups");
  },
  putConnectionGroups(groups: ConnectionGroup[]): Promise<{ ok: boolean }> {
    return invoke("put_connection_groups", { groups });
  },
  getAppSettings(): Promise<AppSettings> {
    return invoke("get_app_settings");
  },
  putAppSettings(settings: AppSettings): Promise<{ ok: boolean }> {
    return invoke("put_app_settings", { settings });
  },

  // ─── Connections ──────────────────────────────────────────────────────
  listConnections(): Promise<ConnectionSummary[]> {
    return invoke("list_connections");
  },
  createConnection(conn: Connection): Promise<ConnectionSummary> {
    return invoke("create_connection", { conn });
  },
  updateConnection(conn: Connection): Promise<ConnectionSummary> {
    return invoke("update_connection", { conn });
  },
  cloneConnection(connId: string): Promise<ConnectionSummary> {
    return invoke("clone_connection", { connId });
  },
  deleteConnection(connId: string): Promise<{ ok: boolean }> {
    return invoke("delete_connection", { connId });
  },
  testConnection(connId: string): Promise<{ ok: boolean }> {
    return invoke("test_connection", { connId });
  },
  selectDatabase(connId: string, db: number): Promise<{ ok: boolean; db: number }> {
    return invoke("select_database", { connId, db });
  },
  setReadonly(connId: string, readonly: boolean): Promise<{ ok: boolean }> {
    return invoke("set_readonly", { connId, readonly });
  },
  getConnectionState(connId: string): Promise<{ ok: boolean; status: string }> {
    return invoke("get_connection_state", { connId });
  },

  // ─── Keys ─────────────────────────────────────────────────────────────
  listKeys(
    connId: string,
    db: number,
    opts: { pattern?: string; cursor?: string; count?: number } = {}
  ): Promise<ListKeysResult> {
    return invoke("list_keys", {
      connId,
      db,
      pattern: opts.pattern ?? null,
      cursor: opts.cursor ?? null,
      count: opts.count ?? null,
    });
  },
  searchKeys(connId: string, db: number, pattern: string, cursor?: string, count?: number): Promise<ListKeysResult> {
    return invoke("search_keys", { connId, db, pattern, cursor: cursor ?? null, count: count ?? null });
  },
  getKeyInfo(connId: string, db: number, key: string): Promise<KeyInfo> {
    return invoke("get_key_info", { connId, db, key });
  },
  getKeyCount(connId: string, db: number): Promise<number> {
    return invoke("get_key_count", { connId, db });
  },
  deleteKeys(connId: string, db: number, keys: string[]): Promise<{ deleted: number }> {
    return invoke("delete_keys", { connId, db, keys });
  },
  getSearchHistory(): Promise<string[]> {
    return invoke("get_search_history");
  },

  // ─── Values: string ───────────────────────────────────────────────────
  getValue(connId: string, db: number, key: string): Promise<StringValue> {
    return invoke("get_value", { connId, db, key });
  },
  setValue(connId: string, db: number, key: string, value: string): Promise<{ ok: boolean }> {
    return invoke("set_value", { connId, db, key, value });
  },
  setValueWithTtl(connId: string, db: number, key: string, value: string, ttlSeconds: number): Promise<{ ok: boolean }> {
    return invoke("set_value_with_ttl", { connId, db, key, value, ttlSeconds });
  },
  getKeyType(connId: string, db: number, key: string): Promise<string> {
    return invoke("get_key_type", { connId, db, key });
  },
  getKeyTtl(connId: string, db: number, key: string): Promise<number> {
    return invoke("get_key_ttl", { connId, db, key });
  },

  // ─── Values: hash ─────────────────────────────────────────────────────
  getHashFields(connId: string, db: number, key: string, cursor?: string, count?: number): Promise<HashFieldsResult> {
    return invoke("get_hash_fields", { connId, db, key, cursor: cursor ?? null, count: count ?? null });
  },
  getHashField(connId: string, db: number, key: string, field: string): Promise<string> {
    return invoke("get_hash_field", { connId, db, key, field });
  },
  setHashField(connId: string, db: number, key: string, field: string, value: string): Promise<{ ok: boolean }> {
    return invoke("set_hash_field", { connId, db, key, field, value });
  },
  deleteHashField(connId: string, db: number, key: string, fields: string[]): Promise<{ deleted: number }> {
    return invoke("delete_hash_field", { connId, db, key, fields });
  },

  // ─── Values: list ─────────────────────────────────────────────────────
  getListItems(connId: string, db: number, key: string, start: number, stop: number): Promise<ListItemsResult> {
    return invoke("get_list_items", { connId, db, key, start, stop });
  },
  pushListItem(connId: string, db: number, key: string, value: string, left: boolean): Promise<{ ok: boolean; length: number }> {
    return invoke("push_list_item", { connId, db, key, value, left });
  },
  deleteListItem(connId: string, db: number, key: string, value: string, index?: number): Promise<{ deleted: number }> {
    return invoke("delete_list_item", { connId, db, key, value, index: index ?? null });
  },
  setListValue(connId: string, db: number, key: string, index: number, value: string): Promise<{ ok: boolean }> {
    return invoke("set_list_value", { connId, db, key, index, value });
  },

  // ─── Values: set ──────────────────────────────────────────────────────
  getSetItems(connId: string, db: number, key: string, cursor?: string, count?: number): Promise<SetMembersResult> {
    return invoke("get_set_items", { connId, db, key, cursor: cursor ?? null, count: count ?? null });
  },
  addSetItem(connId: string, db: number, key: string, members: string[]): Promise<{ added: number }> {
    return invoke("add_set_item", { connId, db, key, members });
  },
  deleteSetItem(connId: string, db: number, key: string, members: string[]): Promise<{ removed: number }> {
    return invoke("delete_set_item", { connId, db, key, members });
  },

  // ─── Key operations ───────────────────────────────────────────────────
  createKey(connId: string, db: number, key: string, valueType: string): Promise<{ ok: boolean }> {
    return invoke("create_key", { connId, db, key, valueType });
  },
  renameKey(connId: string, db: number, src: string, dst: string): Promise<{ ok: boolean }> {
    return invoke("rename_key", { connId, db, src, dst });
  },
  copyKey(connId: string, db: number, src: string, dst: string): Promise<{ ok: boolean }> {
    return invoke("copy_key", { connId, db, src, dst });
  },
  moveKey(connId: string, db: number, key: string, destDb: number): Promise<{ ok: boolean }> {
    return invoke("move_key", { connId, db, key, destDb });
  },
  expireKey(connId: string, db: number, key: string, seconds: number): Promise<{ ok: boolean }> {
    return invoke("expire_key", { connId, db, key, seconds });
  },
  persistKey(connId: string, db: number, key: string): Promise<{ ok: boolean }> {
    return invoke("persist_key", { connId, db, key });
  },
  setKeyExpire(connId: string, db: number, key: string, seconds: number): Promise<{ ok: boolean }> {
    return invoke("set_key_expire", { connId, db, key, seconds });
  },

  // ─── Terminal ─────────────────────────────────────────────────────────
  runCommand(connId: string, db: number, command: string): Promise<{ result: string }> {
    return invoke("run_terminal_command", { connId, db, command });
  },
  runPipeline(connId: string, db: number, commands: string[]): Promise<string[]> {
    return invoke("run_pipeline", { connId, db, commands });
  },
  publishMessage(connId: string, db: number, channel: string, message: string): Promise<{ receivers: number }> {
    return invoke("publish_message", { connId, db, channel, message });
  },
  getCommandHistory(): Promise<string[]> {
    return invoke("get_command_history");
  },
  appendCommandHistory(command: string): Promise<{ ok: boolean }> {
    return invoke("append_command_history", { command });
  },
  clearCommandHistory(): Promise<{ ok: boolean }> {
    return invoke("clear_command_history");
  },
};

/** Read a value by raw field for display; typed convenience over api calls. */
export type { HashField };
