import { useCallback, useEffect, useState } from "react";
import { Table, Button, Space, Tooltip } from "antd";
import { ReloadOutlined, DisconnectOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { useContainerHeight } from "../utils";

type Client = Record<string, string>;

export function ClientsPanel({ target }: { target: SelectedTarget }) {
  const [rows, setRows] = useState<Client[]>([]);
  const [selfId, setSelfId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [fillRef, fillH] = useContainerHeight();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listClients(target.connectionId);
      setRows(res.clients);
      setSelfId(res.selfId);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [target.connectionId]);

  const kill = async (id: string) => {
    try {
      await api.killClient(target.connectionId, id);
      message.success(`killed client ${id}`);
      load();
    } catch (e) {
      message.error(String(e));
    }
  };

  // Load on entry (mirrors the Slow Log page) so the panel isn't blank.
  useEffect(() => {
    load();
  }, [load]);

  const confirmKill = (id: string) => {
    modal.confirm({
      title: "Kill client",
      content: `Kill client ${id}?`,
      okText: "Kill",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: () => kill(id),
    });
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12, overflow: "hidden" }}>
      <div ref={fillRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <Table<Client>
        size="small"
        rowKey="id"
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 50, size: "small" }}
        scroll={{ y: fillH }}
        style={{ height: fillH }}
        onRow={(r) => ({
          style: r.id === String(selfId) ? { background: "rgba(22,119,255,0.14)" } : {},
        })}
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "Addr", dataIndex: "addr", width: 180, ellipsis: { showTitle: true }, render: (v: string) => <Tooltip title={v}><span>{v}</span></Tooltip> },
          { title: "Name", dataIndex: "name", width: 120, ellipsis: { showTitle: true }, render: (v: string) => <Tooltip title={v}><span>{v}</span></Tooltip> },
          { title: "DB", dataIndex: "db", width: 60 },
          { title: "Cmd", dataIndex: "cmd", width: 90 },
          { title: "Flags", dataIndex: "flags", width: 80 },
          { title: "Idle", dataIndex: "idle", width: 70, align: "right", render: (v: string) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span> },
          { title: "User", dataIndex: "user", width: 100, ellipsis: { showTitle: true }, render: (v: string) => <Tooltip title={v}><span>{v}</span></Tooltip> },
          {
            title: (
              <Tooltip title="Refresh">
                <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={load} />
              </Tooltip>
            ),
            width: 60,
            align: "center",
            render: (_, r) => (
              <Tooltip title="Kill client">
                <Button size="small" type="text" danger icon={<DisconnectOutlined />} onClick={() => confirmKill(r.id)} />
              </Tooltip>
            ),
          },
        ]}
      />
      </div>
    </div>
  );
}
