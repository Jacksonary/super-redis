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
  SlowlogEntry,
  StreamEntry,
  StreamInfo,
  StringValue,
  ZSetItemsResult,
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
  exportConfig(): Promise<string> {
    return invoke("export_config");
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
  disconnectConnection(connId: string): Promise<{ ok: boolean }> {
    return invoke("disconnect_connection", { connId });
  },
  getConnectionStatus(connId: string): Promise<{ connected: boolean; healthy: boolean }> {
    return invoke("get_connection_status", { connId });
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
  unlinkKeys(connId: string, db: number, keys: string[]): Promise<{ deleted: number }> {
    return invoke("unlink_keys", { connId, db, keys });
  },
  getSearchHistory(): Promise<string[]> {
    return invoke("get_search_history");
  },
  deleteKeysByPattern(connId: string, db: number, pattern: string): Promise<{ deleted: number }> {
    return invoke("delete_keys_by_pattern", { connId, db, pattern });
  },

  // ─── Values: string ───────────────────────────────────────────────────
  getValue(connId: string, db: number, key: string): Promise<StringValue> {
    return invoke("get_value", { connId, db, key });
  },
  setValue(connId: string, db: number, key: string, value: string): Promise<{ ok: boolean }> {
    return invoke("set_value", { connId, db, key, value });
  },
  decodeValue(connId: string, db: number, key: string, format: string): Promise<{ text: string; is_binary: boolean }> {
    return invoke("decode_value", { connId, db, key, format });
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
  renameHashField(connId: string, db: number, key: string, oldField: string, newField: string, value: string): Promise<{ ok: boolean }> {
    return invoke("rename_hash_field", { connId, db, key, oldField, newField, value });
  },
  deleteHashField(connId: string, db: number, key: string, fields: string[]): Promise<{ deleted: number }> {
    return invoke("delete_hash_field", { connId, db, key, fields });
  },
  searchHashField(connId: string, db: number, key: string, field: string): Promise<HashFieldsResult> {
    return invoke("search_hash_field", { connId, db, key, field });
  },

  // ─── Values: list ─────────────────────────────────────────────────────
  getListItems(connId: string, db: number, key: string, start: number, stop: number): Promise<ListItemsResult> {
    return invoke("get_list_items", { connId, db, key, start, stop });
  },
  searchListValue(connId: string, db: number, key: string, value: string): Promise<{ found: boolean; index: number; value: string; total: number }> {
    return invoke("search_list_value", { connId, db, key, value });
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
  searchSetMember(connId: string, db: number, key: string, member: string): Promise<SetMembersResult> {
    return invoke("search_set_member", { connId, db, key, member });
  },
  renameSetMember(connId: string, db: number, key: string, oldMember: string, newMember: string): Promise<{ ok: boolean }> {
    return invoke("rename_set_member", { connId, db, key, oldMember, newMember });
  },

  // ─── Key operations ───────────────────────────────────────────────────
  createKey(
    connId: string,
    db: number,
    key: string,
    valueType: string,
    opts: { value?: string; field?: string; score?: number; ttl?: number } = {}
  ): Promise<{ ok: boolean }> {
    return invoke("create_key", {
      connId,
      db,
      key,
      valueType,
      value: opts.value ?? null,
      field: opts.field ?? null,
      score: opts.score ?? null,
      ttl: opts.ttl ?? null,
    });
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

  // ─── Values: zset ──────────────────────────────────────────────────────
  getZsetItems(connId: string, db: number, key: string, cursor?: string, count?: number): Promise<ZSetItemsResult> {
    return invoke("get_zset_items", { connId, db, key, cursor: cursor ?? null, count: count ?? null });
  },
  addZsetItem(connId: string, db: number, key: string, member: string, score: number): Promise<{ added: number }> {
    return invoke("add_zset_item", { connId, db, key, member, score });
  },
  deleteZsetItem(connId: string, db: number, key: string, members: string[]): Promise<{ removed: number }> {
    return invoke("delete_zset_item", { connId, db, key, members });
  },
  searchZsetMember(connId: string, db: number, key: string, member: string): Promise<ZSetItemsResult> {
    return invoke("search_zset_member", { connId, db, key, member });
  },
  updateZsetScore(connId: string, db: number, key: string, member: string, score: number): Promise<{ ok: boolean }> {
    return invoke("update_zset_score", { connId, db, key, member, score });
  },
  renameZsetMember(connId: string, db: number, key: string, oldMember: string, newMember: string, score: number): Promise<{ ok: boolean }> {
    return invoke("rename_zset_member", { connId, db, key, oldMember, newMember, score });
  },

  // ─── Values: stream ────────────────────────────────────────────────────
  getStreamInfo(connId: string, db: number, key: string): Promise<StreamInfo> {
    return invoke("get_stream_info", { connId, db, key });
  },
  readStreamEntries(connId: string, db: number, key: string, start?: string, end?: string, count?: number): Promise<{ entries: StreamEntry[] }> {
    return invoke("read_stream_entries", { connId, db, key, start: start ?? null, end: end ?? null, count: count ?? null });
  },
  addStreamEntry(connId: string, db: number, key: string, fields: Record<string, string>): Promise<{ id: string }> {
    return invoke("add_stream_entry", { connId, db, key, fields });
  },
  deleteStreamEntry(connId: string, db: number, key: string, ids: string[]): Promise<{ deleted: number }> {
    return invoke("delete_stream_entry", { connId, db, key, ids });
  },
  createConsumerGroup(connId: string, db: number, key: string, group: string): Promise<{ ok: boolean }> {
    return invoke("create_consumer_group", { connId, db, key, group });
  },

  // ─── Monitor / info ────────────────────────────────────────────────────
  getDbCount(connId: string): Promise<number> {
    return invoke("get_db_count", { connId });
  },
  getServerInfo(connId: string): Promise<unknown> {
    return invoke("get_server_info", { connId });
  },
  getSlowlog(connId: string, db: number, count?: number): Promise<{ entries: SlowlogEntry[] }> {
    return invoke("get_slowlog", { connId, db, count: count ?? null });
  },
  clearSlowlog(connId: string, db: number): Promise<{ ok: boolean }> {
    return invoke("clear_slowlog", { connId, db });
  },
};

/** Read a value by raw field for display; typed convenience over api calls. */
export type { HashField };
