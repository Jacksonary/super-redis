import { useMemo, useState } from "react";
import { Dropdown, Button, Tooltip, List, Typography, Modal, Space } from "antd";
import {
  PlusOutlined,
  SettingOutlined,
  ApiOutlined,
  EditOutlined,
  CopyOutlined,
  ReadOutlined,
  DeleteOutlined,
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
}

export function Sidebar(props: Props) {
  const { connections, selected, onSelect, onConnectionsChange } = props;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectionSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionSummary | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string | null, ConnectionSummary[]>();
    for (const c of connections) {
      const k = c.group ?? null;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(c);
    }
    return [...map.entries()];
  }, [connections]);

  const onSelectConnection = (conn: ConnectionSummary, db: number) => {
    onSelect({ connectionId: conn.id, db });
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
      key: "test",
      label: props.locale === "zh-CN" ? "Test Connection" : "Test Connection",
      icon: <ApiOutlined />,
      onClick: () => api.testConnection(conn.id),
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
          <Tooltip title={props.locale === "zh-CN" ? "Settings" : "Settings"}>
            <Button size="small" icon={<SettingOutlined />} onClick={props.onOpenSettings} />
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
                            background: conn.color ?? "#4C9BFA",
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

      <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <Text type="secondary" style={{ fontSize: 11 }}>Super Redis</Text>
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
        okText={props.locale === "zh-CN" ? "OK" : "OK"}
        cancelText={props.locale === "zh-CN" ? "Cancel" : "Cancel"}
        onOk={handleDelete}
        onCancel={() => setConfirmDelete(null)}
        okButtonProps={{ danger: true }}
      >
        {confirmDelete
          ? props.locale === "zh-CN"
            ? `Delete connection "${confirmDelete.name}」？`
            : `Delete connection "${confirmDelete.name}"?`
          : ""}
      </Modal>
    </div>
  );
}
