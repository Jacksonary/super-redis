import { useEffect, useState } from "react";
import { Table, theme } from "antd";
import type { TableColumnsType } from "antd";
import { message } from "../antd-app";
import type { SelectedTarget, MemoryStat } from "../types";
import { api } from "../api";
import { formatBytes, useTableBodyHeight } from "../utils";
import { TruncatedText } from "./TruncatedText";
import { ResizableTitle, useResizableColumns } from "./ResizableTable";

export function MemoryPanel({
  target,
  pattern,
  sample,
  analyzeSignal,
  onScanned,
}: {
  target: SelectedTarget;
  pattern: string;
  sample: number;
  analyzeSignal: number;
  onScanned: (n: number) => void;
}) {
  const { token } = theme.useToken();
  const [rows, setRows] = useState<MemoryStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [fillRef, bodyH] = useTableBodyHeight();

  const analyze = async () => {
    setLoading(true);
    try {
      const res = await api.analyzeMemory(target.connectionId, target.db, pattern || undefined, sample);
      setRows(res);
      onScanned(res.length);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Analyze on entry (mirrors Slow Log) so the panel isn't blank, and again when
  // the bottom-bar Analyze button bumps the signal.
  useEffect(() => {
    void analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.connectionId, target.db, analyzeSignal]);

  const baseColumns: TableColumnsType<MemoryStat> = [
    {
      title: "Key",
      dataIndex: "key",
      width: 380,
      ellipsis: { showTitle: false },
      render: (k: string) => <TruncatedText className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{k}</TruncatedText>,
    },
    {
      title: "Size",
      dataIndex: "size",
      width: 130,
      align: "right",
      sorter: (a, b) => a.size - b.size,
      render: (s: number) => (
        <span
          className="mono"
          style={{ fontSize: 12, color: s < 0 ? token.colorTextTertiary : s >= 64 * 1024 * 1024 ? token.colorError : s >= 1024 * 1024 ? token.colorWarning : token.colorTextSecondary }}
        >
          {s < 0 ? "-" : formatBytes(s)}
        </span>
      ),
    },
  ];
  const columns = useResizableColumns(baseColumns);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
      <div ref={fillRef} style={{ flex: 1, minHeight: 0 }}>
      <Table<MemoryStat>
        size="small"
        rowKey="key"
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 50, size: "small" }}
        scroll={{ y: bodyH }}
        style={{ height: "100%" }}
        columns={columns}
        components={{ header: { cell: ResizableTitle } }}
      />
      </div>
    </div>
  );
}
