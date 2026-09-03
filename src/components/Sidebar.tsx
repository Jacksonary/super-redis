import { useMemo, useState } from "react";
import { Dropdown, Button, Tooltip, List, Typography, Modal, Space, message } from "antd";
import {
  PlusOutlined,
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
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionSummary | null>(null);
  const [status, setStatus] = useState<Record<string, "ok" | "error" | "disconnected">>({});

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
        <Space>
          <Tooltip title={props.locale === "zh-CN" ? "New Connection" : "New connection"}>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }} />
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
      </div>

      <div style={{ padding: "8px 12px", borderTop: `1px solid ${borderColor}`, display: "flex", gap: 8, alignItems: "center" }}>
        <Text type="secondary" style={{ fontSize: 11, flex: 1 }}>Super Redis</Text>
        <Tooltip title={props.isDark ? "Light theme" : "Dark theme"}>
          <Button size="small" icon={props.isDark ? <SunOutlined /> : <MoonOutlined />} onClick={props.onThemeToggle} />
        </Tooltip>
        <Tooltip title="Collapse sidebar">
          <Button size="small" icon={<MenuFoldOutlined />} onClick={props.onCollapse} />
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
