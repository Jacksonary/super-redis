import { useMemo, useRef, useState } from "react";
import { Dropdown, Button, Tooltip, List, Typography, Modal, Space, Progress, theme } from "antd";
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
  MenuFoldOutlined,
  SettingOutlined,
  FolderOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";
import type { ConnectionSummary, SelectedTarget } from "../types";
import { api } from "../api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ConnectionForm } from "./ConnectionForm";
import { TruncatedText } from "./TruncatedText";
import { tuneConnectionColor } from "../utils";

const { Text } = Typography;

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
  // Groups (named, non-null) the user has collapsed. Empty set = all expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Id of the connection currently being dragged, or null when idle.
  const [dragConnId, setDragConnId] = useState<string | null>(null);
  // Drop target currently hovered: `group:<gid>` or `ungroup` or null. Drives the
  // visible highlight so the user sees where a drop will land while dragging.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, "ok" | "error" | "disconnected">>({});
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

  const groups = useMemo(() => {
    const map = new Map<string | null, ConnectionSummary[]>();
    for (const c of connections) {
      const k = c.group ?? null;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return [...map.entries()];
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
    try {
      const conn = connections.find((c) => c.id === dragConnId);
      if (!conn || conn.group === gid) return;
      await api.setConnectionGroup(conn.id, gid);
      onConnectionsChange();
    } catch (e) {
      message.error(`Move to group failed: ${String(e)}`);
    } finally {
      setDragConnId(null);
    }
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
    { type: "divider" as const },
    {
      key: "delete",
      label: props.locale === "zh-CN" ? "Delete" : "Delete",
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => setConfirmDelete(conn),
    },
  ];

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

      <div
        style={{ flex: 1, overflow: "auto", padding: "0 2px" }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          // Not over a group header (those stopPropagation), so this is the
          // "move out of any group" drop surface.
          setDropTarget("ungroup");
        }}
        onDrop={(e) => {
          e.preventDefault();
          void dropToGroup(null);
          setDropTarget(null);
        }}
      >
        {groups.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <Text type="secondary">{props.locale === "zh-CN" ? "No connections yet" : "No connections yet"}</Text>
          </div>
        )}
        <div style={{ background: "var(--surface-raised)", borderRadius: 6, border: "1px solid var(--border)" }}>
        <List
          dataSource={groups}
          renderItem={([gid, conns]) => {            const collapsed = gid != null && collapsedGroups.has(gid);
            return (
              <div key={gid ?? "root"}>
                {gid && (
                  <div
                    onClick={() => toggleGroup(gid)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = "move";
                      setDropTarget(`group:${gid}`);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void dropToGroup(gid);
                      setDropTarget(null);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 10px 3px",
                      cursor: "pointer",
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      borderRadius: 6,
                      borderBottom: "1px solid var(--border-hairline)",
                      // Drop-target feedback: a filled accent wash + a left accent
                      // bar so it's obvious dropping here moves into THIS group.
                      background: dropTarget === `group:${gid}` ? "rgba(22,119,255,0.14)" : "transparent",
                      boxShadow:
                        dropTarget === `group:${gid}`
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
                )}
                {!collapsed &&
                  conns.map((conn) => {
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
                          setDragConnId(conn.id);
                          setDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDragConnId(null);
                          setDropTarget(null);
                        }}
                        style={{
                          margin: "2px 0",
                          borderBottom: "1px solid var(--border-hairline)",
                          ...(gid != null ? { paddingLeft: 18 } : {}),
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
                              cursor: "pointer",
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
                  })}
              </div>
            );
          }}
        />
        <div style={{ padding: "4px 8px" }}>
          {dragConnId && (
            <div
              style={{
                marginBottom: 4,
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 12,
                textAlign: "center",
                border: `1px dashed ${dropTarget === "ungroup" ? (props.isDark ? "#4080ff" : "#1677ff") : "var(--border-strong)"}`,
                background: dropTarget === "ungroup" ? "rgba(22,119,255,0.14)" : "transparent",
                color: dropTarget === "ungroup" ? (props.isDark ? "#4080ff" : "#1677ff") : token.colorTextTertiary,
                transition: "background-color .12s ease, border-color .12s ease",
              }}
            >
              {dropTarget === "ungroup" ? "Release to remove from all groups" : "Drop here to move out of groups"}
            </div>
          )}
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
    </div>
  );
}
