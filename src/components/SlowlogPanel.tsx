import { useEffect, useCallback, useState } from "react";
import { Table, Button, Space, message } from "antd";
import type { SelectedTarget, SlowlogEntry } from "../types";
import { api } from "../api";

export function SlowlogPanel({ target }: { target: SelectedTarget }) {
  const [rows, setRows] = useState<SlowlogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getSlowlog(target.connectionId, target.db, 20);
      setRows(res.entries);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    load();
  }, [load]);

  const clear = async () => {
    await api.clearSlowlog(target.connectionId, target.db);
    message.success("cleared");
    load();
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8 }}>
        <Space>
          <Button size="small" onClick={load}>Refresh</Button>
          <Button size="small" danger onClick={clear}>Clear</Button>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{rows.length} entries</span>
        </Space>
      </div>
      <Table<SlowlogEntry>
        size="small"
        rowKey="id"
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "Duration (µs)", dataIndex: "duration_us", width: 110 },
          { title: "Command", dataIndex: "command", render: (c: string) => <span style={{ fontSize: 11.5, fontFamily: "monospace" }}>{c}</span> },
          { title: "Client", dataIndex: "client", width: 120 },
        ]}
        dataSource={rows}
        loading={loading}
        pagination={false}
        scroll={{ y: 200 }}
      />
    </div>
  );
}
