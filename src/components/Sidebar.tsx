import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown, Button, Tooltip, List, Typography, Modal, Space, Progress, theme, Form, Input } from "antd";
import { message, modal } from "../antd-app";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdateCheck } from "../useUpdateCheck";
import {
  PlusOutlined,
  GithubOutlined,
  ReloadOutlined,
  ApiOutlined,
  EditOutlined,
  CopyOutlined,
  ReadOutlined,
  DeleteOutlined,
  LinkOutlined,
  DisconnectOutlined,
  ExportOutlined,
  MenuFoldOutlined,
  SettingOutlined,
  FolderOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import type { ConnectionSummary, SelectedTarget } from "../types";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ConnectionForm } from "./ConnectionForm";
import { TruncatedText } from "./TruncatedText";
import { tuneConnectionColor } from "../utils";

const { Text } = Typography;

// What's being dragged in the sidebar. Connections move one row (position and,
// when dropped across a bucket boundary, group); groups move as a whole block.
type DragState = { kind: "conn"; id: string } | { kind: "group"; gid: string };
// Landing edge for a reorder drag, rendered as a 2px accent line.
type InsertSpot =
  | { kind: "row"; anchorId: string; before: boolean }
  | { kind: "group"; anchorGid: string; before: boolean };

// Top-level sidebar items in display order: group blocks interleaved with
// ungrouped connections, which are SIBLINGS of the groups (a loose connection
// is its own top-level item, not a member of a hidden bucket). The connections
// array order in config.json remains the single source of truth.
type TopItem =
  | { kind: "group"; gid: string; conns: ConnectionSummary[] }
  | { kind: "loose"; conn: ConnectionSummary };

interface Props {
  connections: ConnectionSummary[];
  selected: SelectedTarget | null;
  onSelect: (t: SelectedTarget | null) => void;
  isDark: boolean;
  locale: string;
  onLocaleChange: (l: string) => void;
  onConnectionsChange: () => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
}

export function Sidebar(props: Props) {
  const { connections, selected, onSelect, onConnectionsChange } = props;
  const borderColor = props.isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)";
  const { token } = theme.useToken();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionSummary | null>(null);
  // Group-level dialogs. A group has no id — `gid` IS the group name string (the
  // value stored in ConnectionSummary.group), so these hold plain names.
  const [renameGroup, setRenameGroup] = useState<string | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<{ name: string; count: number } | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupForm] = Form.useForm<{ name: string }>();
  // Groups (named, non-null) the user has collapsed. Empty set = all expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // What is being dragged. Kind "conn" is a connection row; kind "group" is a
  // whole group header (whose block moves as a unit).
  const [dragState, setDragState] = useState<DragState | null>(null);
  // Derived for the existing "move into/out of groups" logic, which predates
  // ordering and only ever dragged connection rows.
  const dragConnId = dragState?.kind === "conn" ? dragState.id : null;
  // Drop target currently hovered: `group:<gid>` / `ungroup` / `end` or null.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Where a reorder drop will land: an accent line on the target edge.
  const [insertSpot, setInsertSpot] = useState<InsertSpot | null>(null);

  const clearDrag = () => {
    setDragState(null);
    setDropTarget(null);
    setInsertSpot(null);
  };
  const [status, setStatus] = useState<Record<string, "ok" | "error" | "disconnected">>({});

  // Backend-pushed connection states. `test_connection` publishes ok/error, and
  // editing a live connection's transport/auth settings publishes "disconnected"
  // so the sidebar reflects the drop immediately instead of staying stale-green
  // until the next click. Mirrors what the manual Disconnect action does.
  useEffect(() => {
    const un = listen<{ id: string; status: string }>("connection-state", (e) => {
      const { id, status: st } = e.payload;
      const mapped = st === "ok" ? "ok" : st === "error" ? "error" : "disconnected";
      setStatus((p) => ({ ...p, [id]: mapped }));
      // An edit cut the connection the user is looking at: reset the workspace
      // to the dashboard, exactly like a manual disconnect.
      if (mapped === "disconnected" && selected?.connectionId === id) {
        onSelect(null);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [selected, onSelect]);
  const { state: updateState, setState: setUpdateState, checking, recheck } = useUpdateCheck(__APP_VERSION__);

  const modalOpenRef = useRef(false);
  const downloadingRef = useRef(false);
  const pendingUpdateRef = useRef<{ install: () => Promise<void> } | null>(null);
  const readyVersionRef = useRef<string>("");

  function showRestartModal(version: string) {
    if (modalOpenRef.current) return;
    modalOpenRef.current = true;
    modal.confirm({
      title: "Update ready",
      content: `Version ${version} has been downloaded. Restart now to apply it, or later.`,
      okText: "Restart now",
      cancelText: "Later",
      onOk: async () => {
        modalOpenRef.current = false;
        if (pendingUpdateRef.current) {
          try {
            await pendingUpdateRef.current.install();
          } catch (e) {
            void message.error(`Install failed: ${String(e)}`);
            return;
          }
        }
        void relaunch();
      },
      onCancel: () => {
        modalOpenRef.current = false;
      },
    });
  }

  const handleUpdate = async () => {
    if (updateState.status !== "available" || downloadingRef.current) return;
    downloadingRef.current = true;
    const upd = updateState.update;
    const version = updateState.version;
    pendingUpdateRef.current = upd;
    let total = 0;
    let downloaded = 0;
    setUpdateState({ status: "downloading", progress: 0 });
    try {
      await upd.download((evt) => {
        if (evt.event === "Started" && evt.data.contentLength) total = evt.data.contentLength;
        else if (evt.event === "Progress") {
          downloaded += evt.data.chunkLength;
          if (total > 0) setUpdateState({ status: "downloading", progress: Math.round((downloaded / total) * 100) });
        }
      });
      readyVersionRef.current = version;
      setUpdateState({ status: "ready" });
      showRestartModal(version);
    } catch (e) {
      setUpdateState({ status: "error", message: String(e) });
    } finally {
      downloadingRef.current = false;
    }
  };

  // Top-level sequence in display order: each named group becomes ONE block
  // item; each ungrouped connection becomes its own loose item. Both kinds
  // interleave freely, so groups and loose connections sort among themselves.
  const topItems = useMemo<TopItem[]>(() => {
    const buckets = new Map<string | null, ConnectionSummary[]>();
    const seen: (string | null)[] = [];
    for (const c of connections) {
      const k = c.group ?? null;
      if (!buckets.has(k)) {
        buckets.set(k, []);
        seen.push(k);
      }
      buckets.get(k)!.push(c);
    }
    const out: TopItem[] = [];
    for (const k of seen) {
      if (k === null) {
        for (const conn of buckets.get(null)!) out.push({ kind: "loose", conn });
      } else {
        out.push({ kind: "group", gid: k, conns: buckets.get(k)! });
      }
    }
    return out;
  }, [connections]);

  const toggleGroup = (gid: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return next;
    });
  };

  // Drop target callback: move the dragged connection into `gid` (a group name)
  // or out of any group when `gid` is null.
  const dropToGroup = async (gid: string | null) => {
    const connId = dragState?.kind === "conn" ? dragState.id : null;
    try {
      const conn = connId ? connections.find((c) => c.id === connId) : undefined;
      if (!conn || conn.group === gid) return;
      await api.setConnectionGroup(conn.id, gid);
      onConnectionsChange();
    } catch (e) {
      message.error(`Move to group failed: ${String(e)}`);
    } finally {
      clearDrag();
    }
  };

  // The rows in display order (first-occurrence group order). config.json's
  // connections array order is the single source of truth for all of this.
  const flatRows = (): { id: string; gid: string | null }[] =>
    topItems.flatMap((t) =>
      t.kind === "group"
        ? t.conns.map((c) => ({ id: c.id, gid: t.gid as string | null }))
        : [{ id: t.conn.id, gid: null }],
    );

  // The final (order, group) for every row — the reorder command applies both,
  // so a cross-group drop changes membership in the same write as the reorder.
  const persistOrder = async (ordered: { id: string; group: string | null }[]) => {
    try {
      await api.reorderConnections(ordered);
      onConnectionsChange();
    } catch (e) {
      message.error(`Reorder failed: ${String(e)}`);
    }
  };

  const currentOrdering = () => flatRows().map((r) => ({ id: r.id, group: r.gid }));
  const sameOrdering = (a: { id: string; group: string | null }[], b: { id: string; group: string | null }[]) =>
    a.length === b.length && a.every((x, i) => x.id === b[i].id && x.group === b[i].group);

  // Row-level move: place `dragId` exactly at `anchorId`'s slot (before/after
  // it), adopting the anchor row's group — so dragging across a group boundary
  // by position changes membership, same as alphabetical explorers do.
  const applyConnMove = (dragId: string, anchorId: string, before: boolean) => {
    if (dragId === anchorId) return;
    const rows = flatRows();
    const si = rows.findIndex((r) => r.id === dragId);
    const ti = rows.findIndex((r) => r.id === anchorId);
    if (si === -1 || ti === -1) return;
    const source = rows[si];
    const target = rows[ti];
    rows.splice(si, 1);
    let at = rows.findIndex((r) => r.id === anchorId);
    if (!before) at += 1;
    rows.splice(at, 0, { id: source.id, gid: target.gid });
    const ordered = rows.map((r) => ({ id: r.id, group: r.gid }));
    // Dropped back where it started (same slot AND same group): skip.
    if (sameOrdering(ordered, currentOrdering())) return;
    void persistOrder(ordered);
  };

  // Block-level move of a whole group, its members keeping relative order.
  // Anchors are top-level items: another group's header edge, a loose
  // connection's edge, or — with no anchor — the very end of the list.
  const applyGroupMove = (
    gid: string,
    anchor: { kind: "group" | "loose"; id: string; before: boolean },
  ) => {
    const items = topItems;
    const gi = items.findIndex((t) => t.kind === "group" && t.gid === gid);
    if (gi === -1) return;
    const moved = items[gi];
    const rest = items.filter((_, i) => i !== gi);
    const at = rest.findIndex((t) =>
      anchor.kind === "group"
        ? t.kind === "group" && t.gid === anchor.id
        : t.kind === "loose" && t.conn.id === anchor.id,
    );
    if (at === -1) return;
    rest.splice(anchor.before ? at : at + 1, 0, moved);
    const ordered = rest.flatMap((t) =>
      t.kind === "group"
        ? t.conns.map((c) => ({ id: c.id, group: t.gid }))
        : [{ id: t.conn.id, group: null as string | null }],
    );
    if (sameOrdering(ordered, currentOrdering())) return;
    void persistOrder(ordered);
  };

  const refreshStatus = async (connId: string) => {
    try {
      const s = await api.getConnectionStatus(connId);
      setStatus((p) => ({ ...p, [connId]: s.healthy ? "ok" : "error" }));
    } catch {
      setStatus((p) => ({ ...p, [connId]: "error" }));
    }
  };

  const onSelectConnection = (conn: ConnectionSummary, db: number) => {
    onSelect({ connectionId: conn.id, db });
    refreshStatus(conn.id);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.deleteConnection(confirmDelete.id);
      onConnectionsChange();
    } catch (e) {
      console.error(e);
    }
    setConfirmDelete(null);
  };

  // Pre-fill the rename field when the target changes. This has to be an effect:
  // the Form is only "connected" to the useForm instance once the Modal has
  // rendered its children, which happens in the same commit as setRenameGroup().
  // Calling setFieldsValue from the menu's onClick would be lost (and warns).
  useEffect(() => {
    if (renameGroup) groupForm.setFieldsValue({ name: renameGroup });
  }, [renameGroup, groupForm]);

  const doRenameGroup = async () => {
    if (!renameGroup) return;
    let next = "";
    try {
      const v = await groupForm.validateFields();
      next = (v.name ?? "").trim();
    } catch {
      return; // antd renders the inline errors; keep the modal open
    }
    const oldName = renameGroup;
    if (!next || next === oldName) {
      // No-op rename: nothing to tell the backend about.
      setRenameGroup(null);
      return;
    }
    setGroupBusy(true);
    try {
      const res = await api.renameConnectionGroup(oldName, next);
      if (res.renamed > 0) {
        // Carry the collapsed flag across so the renamed group keeps its visual
        // state, and no stale name is left behind for a future group to inherit.
        // Skipped when nothing was renamed — otherwise `next` would linger in the
        // set and silently collapse some unrelated future group of that name.
        setCollapsedGroups((prev) => {
          if (!prev.has(oldName)) return prev;
          const n = new Set(prev);
          n.delete(oldName);
          n.add(next);
          return n;
        });
      }
      setRenameGroup(null);
      onConnectionsChange();
      if (res.renamed === 0) {
        // The group was emptied or renamed elsewhere while the dialog was open.
        // Don't claim success for a rename that touched nothing.
        message.warning(
          props.locale === "zh-CN"
            ? `组 "${oldName}" 已不存在`
            : `Group "${oldName}" no longer exists`
        );
      } else {
        message.success(
          props.locale === "zh-CN"
            ? `已将组 "${oldName}" 重命名为 "${next}"`
            : `Renamed group "${oldName}" to "${next}"`
        );
      }
    } catch (e) {
      // Keep the modal open so the user can pick another name and retry.
      message.error(props.locale === "zh-CN" ? `重命名失败: ${String(e)}` : `Rename group failed: ${String(e)}`);
    } finally {
      setGroupBusy(false);
    }
  };

  const doDeleteGroup = async () => {
    if (!confirmDeleteGroup) return;
    const name = confirmDeleteGroup.name;

    // Snapshot the victims BEFORE the IPC: the `connections` prop stays stale
    // until the parent refetches, and we need the ids to clear selection/status.
    const victims = new Set(
      connections.filter((c) => (c.group ?? null) === name).map((c) => c.id)
    );

    setGroupBusy(true);
    try {
      const res = await api.deleteConnectionGroup(name);

      // Same treatment as "Disconnect": if the workspace is showing a connection
      // that just ceased to exist, drop back to the empty state.
      if (selected && victims.has(selected.connectionId)) onSelect(null);
      setStatus((p) => {
        const n = { ...p };
        for (const id of victims) delete n[id];
        return n;
      });
      // The group itself disappears on its own (groups are derived from the
      // connections), but the collapsed-flag set is our own state.
      setCollapsedGroups((prev) => {
        if (!prev.has(name)) return prev;
        const n = new Set(prev);
        n.delete(name);
        return n;
      });

      setConfirmDeleteGroup(null);
      onConnectionsChange();
      if (res.deleted > 0) {
        message.success(
          props.locale === "zh-CN"
            ? `已删除组 "${name}" 及其 ${res.deleted} 个连接`
            : `Deleted group "${name}" and its ${res.deleted} connection(s)`
        );
      }
    } catch (e) {
      // Nothing was written (save_config runs before any keyring delete), so the
      // config and the keychain are untouched — let the user retry.
      message.error(props.locale === "zh-CN" ? `删除失败: ${String(e)}` : `Delete group failed: ${String(e)}`);
    } finally {
      setGroupBusy(false);
    }
  };

  const rowMenu = (conn: ConnectionSummary) => [
    {
      key: "edit",
      label: props.locale === "zh-CN" ? "Edit" : "Edit",
      icon: <EditOutlined />,
      onClick: () => {
        setEditing(conn);
        setFormOpen(true);
      },
    },
    {
      key: "clone",
      label: props.locale === "zh-CN" ? "Clone" : "Clone",
      icon: <CopyOutlined />,
      onClick: () => api.cloneConnection(conn.id).then(() => onConnectionsChange()),
    },
    {
      key: "connect",
      label: "Connect",
      icon: <LinkOutlined />,
      onClick: async () => {
        try {
          await api.testConnection(conn.id);
          setStatus((p) => ({ ...p, [conn.id]: "ok" }));
          message.success("connected");
        } catch (e) {
          setStatus((p) => ({ ...p, [conn.id]: "error" }));
          message.error(String(e));
        }
      },
    },
    {
      key: "disconnect",
      label: "Disconnect",
      icon: <DisconnectOutlined />,
      onClick: async () => {
        await api.disconnectConnection(conn.id);
        setStatus((p) => ({ ...p, [conn.id]: "disconnected" }));
        // Clear the right-hand workspace back to the empty/dashboard state.
        if (selected?.connectionId === conn.id) onSelect(null);
        message.success("disconnected");
      },
    },
    // Explicit membership escape hatch. Drag covers the spatial case, but when
    // there are no loose rows to drop onto (e.g. a single group holding every
    // connection), this is the only way out — and it doubles as the keyboard /
    // no-drag alternative.
    ...(conn.group
      ? [
          {
            key: "ungroup",
            label: props.locale === "zh-CN" ? "移出分组" : "Move out of group",
            icon: <ExportOutlined />,
            onClick: async () => {
              try {
                await api.setConnectionGroup(conn.id, null);
                onConnectionsChange();
              } catch (e) {
                message.error(
                  props.locale === "zh-CN"
                    ? `移出分组失败: ${String(e)}`
                    : `Move out of group failed: ${String(e)}`,
                );
              }
            },
          },
        ]
      : []),
    { type: "divider" as const },
    {
      key: "delete",
      label: props.locale === "zh-CN" ? "Delete" : "Delete",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => setConfirmDelete(conn),
    },
  ];

  // Right-click menu for a GROUP HEADER row. `gid` is always a real group name:
  // the ungrouped bucket (gid === null) renders no header row to right-click.
  // No CSS variables here — the menu portals outside the [data-theme] subtree.
  const groupMenu = (gid: string, conns: ConnectionSummary[]) => [
    {
      key: "rename-group",
      label: "Rename",
      icon: <EditOutlined />,
      onClick: () => setRenameGroup(gid),
    },
    { type: "divider" as const },
    {
      key: "delete-group",
      // Kept terse to match the connection menu. The blast radius (how many
      // connections go with the group) is spelled out in the confirm dialog.
      label: "Delete",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => setConfirmDeleteGroup({ name: gid, count: conns.length }),
    },
  ];

  // One connection row. `gid` is the owning group or null for loose rows —
  // shared verbatim by group members and top-level loose items.
  const renderRow = (conn: ConnectionSummary, gid: string | null) => {
    const active = selected?.connectionId === conn.id;
    return (
                      <div
                        key={conn.id}
                        draggable
                        onDragStart={(e) => {
                          // WebKit (macOS/Linux tauri webview) only enters a real
                          // drop sequence if dragstart sets dataTransfer data.
                          e.dataTransfer.setData("text/plain", conn.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragState({ kind: "conn", id: conn.id });
                          setDropTarget(null);
                          setInsertSpot(null);
                        }}
                        onDragEnd={clearDrag}
                        onDragOver={(e) => {
                          if (dragState?.kind === "conn") {
                            if (dragState.id === conn.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = "move";
                            const r = e.currentTarget.getBoundingClientRect();
                            setDropTarget(null);
                            setInsertSpot({
                              kind: "row",
                              anchorId: conn.id,
                              before: e.clientY < r.top + r.height / 2,
                            });
                          } else if (dragState?.kind === "group" && gid === null) {
                            // Loose rows are top-level SIBLINGS of the groups, so
                            // a group block can land on their edges — this is the
                            // mixed group/connection ordering.
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = "move";
                            const r = e.currentTarget.getBoundingClientRect();
                            setDropTarget(null);
                            setInsertSpot({
                              kind: "row",
                              anchorId: conn.id,
                              before: e.clientY < r.top + r.height / 2,
                            });
                          }
                        }}
                        onDrop={(e) => {
                          if (dragState?.kind === "conn") {
                            if (insertSpot?.kind !== "row" || insertSpot.anchorId !== conn.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            applyConnMove(dragState.id, conn.id, insertSpot.before);
                            clearDrag();
                          } else if (dragState?.kind === "group" && gid === null) {
                            if (insertSpot?.kind !== "row" || insertSpot.anchorId !== conn.id) return;
                            e.preventDefault();
                            e.stopPropagation();
                            applyGroupMove(dragState.gid, {
                              kind: "loose",
                              id: conn.id,
                              before: insertSpot.before,
                            });
                            clearDrag();
                          }
                        }}
                        style={{
                          margin: "2px 0",
                          borderBottom: "1px solid var(--border-hairline)",
                          ...(gid != null ? { paddingLeft: 18 } : {}),
                          // 2px accent line on the edge the dragged row will land.
                          boxShadow:
                            insertSpot?.kind === "row" && insertSpot.anchorId === conn.id
                              ? `inset 0 ${insertSpot.before ? "2px" : "-2px"} 0 0 ${props.isDark ? "#4080ff" : "#1677ff"}`
                              : "none",
                          // The row being dragged fades so it reads as "lifted" —
                          // otherwise the OS ghost sits on top of a fully-opaque row.
                          opacity: dragConnId === conn.id ? 0.35 : 1,
                        }}
                      >
                        <Dropdown trigger={["contextMenu"]} menu={{ items: rowMenu(conn) }}>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectConnection(conn, conn.db);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "6px 10px",
                              borderRadius: 6,
                              cursor: "grab",
                              // Row tinted by the connection color so connections are
                              // visually distinguishable; selected row is stronger.
                              // On dark theme, deep presets are nudged lighter first.
                              // Raise the identity tint so the connection color reads
                              // as data (was 9%/22% alpha — near-invisible on grey).
                              // Clean row: selected = a light accent tint; otherwise
                              // white for colored / transparent for none. The
                              // connection color is a small dot (not a whole-row
                              // wash), so multiple colored rows never look dirty.
                              background: active
                                ? "rgba(22,119,255,0.12)"
                                : conn.color
                                ? "var(--surface-raised)"
                                : "transparent",
                            }}
                          >
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: "50%",
                                // Connection health (leading position): ok=green,
                                // error=red, disconnected=grey fill, undetected
                                // (never pinged)=hollow. The ring stays so a hollow
                                // dot is still distinguishable from the row tint.
                                background:
                                  status[conn.id] === "ok"
                                    ? (props.isDark ? token.colorSuccess : "#389e0d")
                                    : status[conn.id] === "error"
                                    ? (props.isDark ? token.colorError : "#cf1322")
                                    : status[conn.id] === "disconnected"
                                    ? token.colorTextTertiary
                                    : "transparent",
                                // 1px contrast ring keeps the health dot visually
                                // dominant so it is not mistaken for the connection's
                                // tint color. Light ring on dark theme, dark ring on
                                // light theme — color-only, no layout effect.
                                boxShadow: props.isDark
                                  ? "0 0 0 1px rgba(255,255,255,0.4)"
                                  : "0 0 0 1px rgba(0,0,0,0.3)",
                                marginRight: 8,
                                flexShrink: 0,
                              }}
                            />
                            <TruncatedText
                              style={{
                                fontSize: 13,
                                flex: 1,
                                minWidth: 0,
                                color: conn.color ? tuneConnectionColor(conn.color, props.isDark) ?? undefined : undefined,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {conn.name}
                            </TruncatedText>
                            {conn.readonly ? (
                              <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                                <ReadOutlined style={{ fontSize: 11 }} />
                              </span>
                            ) : null}
                            <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                              {conn.db}
                            </Text>
                          </div>
                        </Dropdown>
                      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          height: 36, // matches the Workspace breadcrumb height so line 1 === line 2
          padding: "0 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <Text strong style={{ fontSize: 14, color: token.colorTextSecondary }}>
          {props.locale === "zh-CN" ? "Connections" : "Connections"}
        </Text>
        <Space size={4}>
          <Tooltip title="Settings">
            <Button size="small" icon={<SettingOutlined />} onClick={props.onOpenSettings} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 2px" }}>
        {topItems.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <Text type="secondary">{props.locale === "zh-CN" ? "No connections yet" : "No connections yet"}</Text>
          </div>
        )}
        <div style={{ background: "var(--surface-raised)", borderRadius: 6, border: "1px solid var(--border)" }}>
        <List
          dataSource={topItems}
          renderItem={(item) => {            const gid = item.kind === "group" ? item.gid : null;
            const conns = item.kind === "group" ? item.conns : [];
            const collapsed = gid != null && collapsedGroups.has(gid);
            return (
              <div key={item.kind === "group" ? `g:${item.gid}` : `c:${item.conn.id}`}>
                {gid && (
                  // Right-click menu. `trigger={["contextMenu"]}` is REQUIRED: with it
                  // rc-trigger injects ONLY onContextMenu into the cloned child and adds
                  // no wrapper DOM node, so the onClick / onDragOver / onDrop below keep
                  // working untouched and the flex layout is unchanged. Omitting it falls
                  // back to hover — the menu would pop open on mouse-over.
                  <Dropdown trigger={["contextMenu"]} menu={{ items: groupMenu(gid, conns) }}>
                    <div
                      draggable
                      onClick={() => toggleGroup(gid)}
                      onDragStart={(e) => {
                        // WebKit only enters a drop sequence if dragstart sets
                        // dataTransfer data (same note as the connection rows).
                        e.dataTransfer.setData("text/plain", `group:${gid}`);
                        e.dataTransfer.effectAllowed = "move";
                        setDragState({ kind: "group", gid });
                        setDropTarget(null);
                        setInsertSpot(null);
                      }}
                      onDragEnd={clearDrag}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = "move";
                        if (dragState?.kind === "group" && dragState.gid !== gid) {
                          // Group drag: the block lands on this header's edge.
                          const r = e.currentTarget.getBoundingClientRect();
                          setDropTarget(null);
                          setInsertSpot({
                            kind: "group",
                            anchorGid: gid,
                            before: e.clientY < r.top + r.height / 2,
                          });
                        } else if (dragState?.kind === "conn") {
                          // Dropping on a group header = move INTO that group
                          // (appended at its end). Positional sorting within the
                          // group is done by dropping on its rows.
                          setDropTarget(`group:${gid}`);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragState?.kind === "group") {
                          if (insertSpot?.kind === "group" && insertSpot.anchorGid === gid) {
                            applyGroupMove(dragState.gid, {
                              kind: "group",
                              id: gid,
                              before: insertSpot.before,
                            });
                          }
                        } else if (dragState?.kind === "conn") {
                          void dropToGroup(gid);
                          return;
                        }
                        clearDrag();
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 10px 3px",
                        cursor: "grab",
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        borderRadius: 6,
                        borderBottom: "1px solid var(--border-hairline)",
                        // Drop-target feedback for conn drags: a filled accent wash +
                        // a left accent bar so it's obvious dropping here moves
                        // into THIS group. Group drags get a 2px landing line on
                        // the edge the block will be inserted at instead.
                        background: dropTarget === `group:${gid}` && !(dragState?.kind === "group") ? "rgba(22,119,255,0.14)" : "transparent",
                        boxShadow: insertSpot?.kind === "group" && insertSpot.anchorGid === gid
                          ? `inset 0 ${insertSpot.before ? "2px" : "-2px"} 0 0 ${props.isDark ? "#4080ff" : "#1677ff"}`
                          : dropTarget === `group:${gid}` && !(dragState?.kind === "group")
                            ? `inset 3px 0 0 ${props.isDark ? "#4080ff" : "#1677ff"}`
                            : "none",
                        transition: "background-color .12s ease",
                      }}
                    >
                      {collapsed ? (
                        <FolderOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
                      ) : (
                        <FolderOpenOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
                      )}
                      <TruncatedText style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: token.colorTextSecondary }}>{gid}</TruncatedText>
                      <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {conns.length}
                      </Text>
                    </div>
                  </Dropdown>
                )}
                {!collapsed &&
                  conns.map((conn) => renderRow(conn, gid))}
                {item.kind === "loose" && renderRow(item.conn, null)}
              </div>
            );
          }}
        />
        {dragState?.kind === "conn" && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setInsertSpot(null);
              setDropTarget("ungroup");
            }}
            onDragLeave={() => setDropTarget((p) => (p === "ungroup" ? null : p))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void dropToGroup(null);
              clearDrag();
            }}
            style={{
              marginTop: 6,
              padding: "5px 10px",
              borderRadius: 6,
              fontSize: 12,
              textAlign: "center",
              border: `1px dashed ${dropTarget === "ungroup" ? (props.isDark ? "#4080ff" : "#1677ff") : "var(--border-strong)"}`,
              color: dropTarget === "ungroup" ? (props.isDark ? "#4080ff" : "#1677ff") : token.colorTextTertiary,
              background: dropTarget === "ungroup" ? "rgba(22,119,255,0.10)" : "transparent",
            }}
          >
            {props.locale === "zh-CN" ? "移出分组" : "Ungroup"}
          </div>
        )}
        <div style={{ padding: "4px 8px" }}>
          <Button
            type="text"
            block
            size="small"
            icon={<PlusOutlined />}
            style={{ fontSize: 12 }}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add connection
          </Button>
        </div>
        </div>
      </div>

      {/* Collapse control, its own row just above the footer */}
      <div style={{ padding: "0 12px", display: "flex", justifyContent: "flex-end" }}>
        <Tooltip title="Collapse sidebar">
          <Button size="small" type="text" icon={<MenuFoldOutlined />} onClick={props.onCollapse} />
        </Tooltip>
      </div>

      <div style={{ height: 40, padding: "0 12px", borderTop: `1px solid ${borderColor}`, display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {updateState.status === "available" ? (
            <Tooltip title={`v${updateState.version} available — click to update`}>
              <Button size="small" type="link" style={{ padding: 0, height: "auto" }} onClick={handleUpdate}>
                v{__APP_VERSION__} → v{updateState.version}
              </Button>
            </Tooltip>
          ) : updateState.status === "downloading" ? (
            <div>
              <Text style={{ fontSize: 11, opacity: 0.8 }}>Downloading... {updateState.progress}%</Text>
              <Progress percent={updateState.progress} size="small" showInfo={false} />
            </div>
          ) : updateState.status === "ready" ? (
            <Tooltip title="Restart to apply">
              <Button size="small" type="link" style={{ padding: 0, height: "auto" }} onClick={() => showRestartModal(readyVersionRef.current)}>
                Update ready — restart
              </Button>
            </Tooltip>
          ) : updateState.status === "error" ? (
            <Tooltip title={updateState.message}>
              <Button size="small" type="link" style={{ padding: 0, height: "auto" }} onClick={() => recheck()}>
                Update failed — retry
              </Button>
            </Tooltip>
          ) : (
            <Space size={4}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                v{__APP_VERSION__}
              </Text>
              <Tooltip title="Check for updates">
                <ReloadOutlined
                  spin={checking}
                  style={{ fontSize: 11, color: token.colorTextTertiary, cursor: "pointer" }}
                  onClick={async () => {
                    if (checking) return;
                    const result = await recheck();
                    if (result === "up-to-date") message.info("Already up to date");
                    else if (result === "error") message.error("Failed to check for updates");
                  }}
                />
              </Tooltip>
            </Space>
          )}
        </div>
        <Tooltip title="GitHub repository">
          <a
            role="link"
            tabIndex={0}
            aria-label="GitHub repository"
            onClick={() => openUrl("https://github.com/Jacksonary/super-redis")}
            onKeyDown={(e) => e.key === "Enter" && openUrl("https://github.com/Jacksonary/super-redis")}
            style={{ color: token.colorTextTertiary, cursor: "pointer", display: "inline-flex" }}
          >
            <GithubOutlined style={{ fontSize: 14 }} />
          </a>
        </Tooltip>
        <Tooltip title="Gitee repository">
          <a
            role="link"
            tabIndex={0}
            aria-label="Gitee repository"
            onClick={() => openUrl("https://gitee.com/weiguoliu/super-redis")}
            onKeyDown={(e) => e.key === "Enter" && openUrl("https://gitee.com/weiguoliu/super-redis")}
            style={{ color: token.colorTextTertiary, cursor: "pointer", display: "inline-flex" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.26.593.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.26.593.593.593h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
            </svg>
          </a>
        </Tooltip>
      </div>

      <ConnectionForm
        open={formOpen}
        initialSummary={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          onConnectionsChange();
        }}
        locale={props.locale}
      />

      <Modal
        open={!!confirmDelete}
        title={props.locale === "zh-CN" ? "Delete Connection" : "Delete connection"}
        okText="OK"
        cancelText="Cancel"
        onOk={handleDelete}
        onCancel={() => setConfirmDelete(null)}
        okButtonProps={{ danger: true }}
      >
        {confirmDelete ? `Delete connection "${confirmDelete.name}"?` : ""}
      </Modal>

      {/* Delete group. The connection count is spelled out so the blast radius —
          including the saved passwords that go with them — is explicit. */}
      <Modal
        open={!!confirmDeleteGroup}
        title={props.locale === "zh-CN" ? "删除组" : "Delete group"}
        okText={props.locale === "zh-CN" ? "删除" : "Delete"}
        cancelText={props.locale === "zh-CN" ? "取消" : "Cancel"}
        onOk={doDeleteGroup}
        onCancel={() => setConfirmDeleteGroup(null)}
        okButtonProps={{ danger: true, loading: groupBusy }}
        cancelButtonProps={{ disabled: groupBusy }}
      >
        {confirmDeleteGroup
          ? props.locale === "zh-CN"
            ? `将删除组「${confirmDeleteGroup.name}」及其下的全部 ${confirmDeleteGroup.count} 个连接，并清除它们在系统钥匙串中保存的密码。此操作不可撤销。`
            : `This deletes the group "${confirmDeleteGroup.name}" and all ${confirmDeleteGroup.count} connection(s) in it, and clears their saved passwords from the OS keychain. This cannot be undone.`
          : ""}
      </Modal>

      {/* Rename group — mirrors KeyBrowser's rename modal. The form instance is
          pre-filled by the effect above, once the modal has mounted. */}
      <Modal
        className="modal-title-divider"
        open={!!renameGroup}
        title={props.locale === "zh-CN" ? "重命名组" : "Rename group"}
        okText="OK"
        cancelText="Cancel"
        onOk={doRenameGroup}
        onCancel={() => setRenameGroup(null)}
        okButtonProps={{ loading: groupBusy }}
      >
        <Form form={groupForm} layout="vertical" size="small" preserve={false}>
          <Form.Item
            name="name"
            label={props.locale === "zh-CN" ? "组名" : "Group name"}
            rules={[
              { required: true, message: props.locale === "zh-CN" ? "请输入组名" : "Please enter a group name" },
              {
                // Inline duplicate check against the groups currently rendered.
                validator: (_rule, value: string) => {
                  const next = (value ?? "").trim();
                  if (!next || next === renameGroup) return Promise.resolve();
                  if (topItems.some((t) => t.kind === "group" && t.gid === next)) {
                    return Promise.reject(
                      new Error(
                        props.locale === "zh-CN"
                          ? "该组名已存在，请换一个"
                          : "A group with this name already exists"
                      )
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input onPressEnter={doRenameGroup} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
