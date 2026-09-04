import { useMemo, useRef, useState } from "react";
import { Dropdown, Button, Tooltip, List, Typography, Modal, Space, Progress, theme, message } from "antd";
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
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import type { ConnectionSummary, SelectedTarget } from "../types";
import { api } from "../api";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ConnectionForm } from "./ConnectionForm";

const { Text } = Typography;

interface Props {
  connections: ConnectionSummary[];
  selected: SelectedTarget | null;
  onSelect: (t: SelectedTarget | null) => void;
  isDark: boolean;
  onThemeToggle: () => void;
  locale: string;
  onLocaleChange: (l: string) => void;
  onConnectionsChange: () => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
}

export function Sidebar(props: Props) {
  const { connections, selected, onSelect, onConnectionsChange } = props;
  const borderColor = props.isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)";
  const { token } = theme.useToken();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionSummary | null>(null);
  const [status, setStatus] = useState<Record<string, "ok" | "error" | "disconnected">>({});
  const { state: updateState, setState: setUpdateState, checking, recheck } = useUpdateCheck(__APP_VERSION__);
  const modalOpenRef = useRef(false);
  const downloadingRef = useRef(false);
  const pendingUpdateRef = useRef<{ install: () => Promise<void> } | null>(null);
  const readyVersionRef = useRef<string>("");

  function showRestartModal(version: string) {
    if (modalOpenRef.current) return;
    modalOpenRef.current = true;
    Modal.confirm({
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
          padding: "12px 12px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text strong style={{ fontSize: 14 }}>
          {props.locale === "zh-CN" ? "Connections" : "Connections"}
        </Text>
        <Space size={4}>
          <Tooltip title={props.isDark ? "Light theme" : "Dark theme"}>
            <Button size="small" icon={props.isDark ? <SunOutlined /> : <MoonOutlined />} onClick={props.onThemeToggle} />
          </Tooltip>
          <Tooltip title="Collapse sidebar">
            <Button size="small" icon={<MenuFoldOutlined />} onClick={props.onCollapse} />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 6px" }}>
        {groups.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", opacity: 0.5 }}>
            <Text type="secondary">{props.locale === "zh-CN" ? "No connections yet" : "No connections yet"}</Text>
          </div>
        )}
        <List
          dataSource={groups}
          renderItem={([gid, conns]) => (
            <div key={gid ?? "root"}>
              {gid && (
                <Text type="secondary" style={{ display: "block", padding: "6px 12px 2px", fontSize: 12 }}>
                  {gid}
                </Text>
              )}
              {conns.map((conn) => {
                const active = selected?.connectionId === conn.id;
                return (
                  <div key={conn.id} style={{ margin: "2px 0" }}>
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
                          background: active ? "rgba(22,119,255,0.12)" : "transparent",
                        }}
                      >
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: "50%",
                            background:
                              status[conn.id] === "ok"
                                ? "#52c41a"
                                : status[conn.id] === "error"
                                ? "#ff4d4f"
                                : status[conn.id] === "disconnected"
                                ? "#8c8c8c"
                                : conn.color ?? "#4C9BFA",
                            marginRight: 8,
                            flexShrink: 0,
                          }}
                        />
                        <Text style={{ fontSize: 13, flex: 1 }} ellipsis>
                          {conn.name}
                          {conn.readonly ? <ReadOutlined style={{ marginLeft: 4, fontSize: 11 }} /> : null}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {conn.db}
                        </Text>
                      </div>
                    </Dropdown>
                  </div>
                );
              })}
            </div>
          )}
        />
        <div style={{ padding: "8px 12px" }}>
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Add connection
          </Button>
        </div>
      </div>

      <div style={{ padding: "8px 12px", borderTop: `1px solid ${borderColor}`, display: "flex", gap: 8, alignItems: "center" }}>
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
                  style={{ fontSize: 11, opacity: 0.6, cursor: "pointer" }}
                  onClick={async () => {
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
            style={{ color: token.colorTextQuaternary, cursor: "pointer", display: "inline-flex" }}
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
            style={{ color: token.colorTextQuaternary, cursor: "pointer", display: "inline-flex" }}
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
