import { useEffect, useCallback, useState } from "react";
import { Table, Button, Space, theme, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { ReloadOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget, SlowlogEntry } from "../types";
import { api } from "../api";
import { TruncatedText } from "./TruncatedText";
import { ResizableTitle, useResizableColumns } from "./ResizableTable";
import { useTableBodyHeight } from "../utils";

export function SlowlogPanel({ target }: { target: SelectedTarget }) {
  const [rows, setRows] = useState<SlowlogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();

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

  const confirmClear = () => {
    modal.confirm({
      title: "Clear slow log",
      content: "This runs SLOWLOG RESET on the server — it deletes the slow-query log on the Redis server (NOT any local/client data). Continue?",
      okText: "Clear",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: clear,
    });
  };

  // Fill the available panel height (the bottom panel is resizable, so the table
  // height must follow the container instead of a hardcoded scroll offset).
  const [fillRef, fillH] = useTableBodyHeight();

  const baseColumns: TableColumnsType<SlowlogEntry> = [
    { title: "ID", dataIndex: "id", width: 70 },
    {
      title: "Duration (µs)",
      dataIndex: "duration_us",
      width: 110,
      align: "right",
      // Band the severity so slow commands read at a glance: >10ms red,
      // 1-10ms amber, <1ms calm. Signal colors only — never every row.
      render: (d: number) => (
        <span style={{ color: d >= 10000 ? token.colorError : d >= 1000 ? token.colorWarning : token.colorTextSecondary, fontVariantNumeric: "tabular-nums" }}>
          {d}
        </span>
      ),
    },
    { title: "Command", dataIndex: "command", width: 300, ellipsis: { showTitle: false }, render: (c: string) => <TruncatedText className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c}</TruncatedText> },
    { title: "Client", dataIndex: "client", width: 120, ellipsis: { showTitle: false }, render: (c: string) => <TruncatedText className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c}</TruncatedText> },
    {
      title: (
        <Space size={2}>
          <Tooltip title="Refresh">
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} />
          </Tooltip>
          <Tooltip title="Clear (server slow log)">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={confirmClear} />
          </Tooltip>
        </Space>
      ),
      key: "spacer",
      width: 76,
      align: "center",
      render: () => null,
    },
  ];
  const columns = useResizableColumns(baseColumns);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div ref={fillRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <Table<SlowlogEntry>
          size="small"
          rowKey="id"
          columns={columns}
          components={{ header: { cell: ResizableTitle } }}
          dataSource={rows}
          loading={loading}
          pagination={false}
          scroll={{ y: fillH }}
          style={{ height: "100%" }}
        />
      </div>
    </div>
  );
}
