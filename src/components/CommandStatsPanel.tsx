import { useCallback, useEffect, useState } from "react";
import { Table, Button, Space, Typography, theme, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { message } from "../antd-app";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { useContainerHeight } from "../utils";

const { Text } = Typography;

type CmdStat = Record<string, number | string>;
type Latency = { command: string; timestamp: number; latest: number; max: number };

export function CommandStatsPanel({ target }: { target: SelectedTarget }) {
  const { token } = theme.useToken();
  const [stats, setStats] = useState<CmdStat[]>([]);
  const [latency, setLatency] = useState<Latency[]>([]);
  const [loading, setLoading] = useState(false);
  const [fillRef, fillH] = useContainerHeight();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([api.getCommandStats(target.connectionId), api.getLatency(target.connectionId)]);
      setStats(s);
      setLatency(l);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [target.connectionId]);

  // Load on entry (mirrors Slow Log) so the panel isn't blank.
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <div ref={fillRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <Table<CmdStat>
        size="small"
        rowKey="command"
        dataSource={stats}
        loading={loading}
        pagination={{ pageSize: 50, size: "small" }}
        scroll={{ y: fillH }}
        style={{ height: fillH }}
        columns={[
          { title: "Command", dataIndex: "command", ellipsis: { showTitle: true }, render: (c: string) => <Tooltip title={c}><span className="mono" style={{ fontSize: 12 }}>{c}</span></Tooltip> },
          { title: "Calls", dataIndex: "calls", width: 100, align: "right", sorter: (a, b) => Number(a.calls) - Number(b.calls), render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span> },
          { title: "Total µs", dataIndex: "usec", width: 110, align: "right", sorter: (a, b) => Number(a.usec) - Number(b.usec), render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span> },
          {
            title: "µs/call",
            dataIndex: "usec_per_call",
            width: 110,
            align: "right",
            sorter: (a, b) => Number(a.usec_per_call) - Number(b.usec_per_call),
            render: (v: number) => (
              <span
                className="mono"
                style={{ fontSize: 12, color: Number(v) >= 1000 ? token.colorWarning : token.colorTextSecondary }}
              >
                {Number(v).toFixed(1)}
              </span>
            ),
          },
          { title: "Failed", dataIndex: "failed_calls", width: 80, align: "right", render: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span> },
          {
            title: (
              <Tooltip title="Refresh">
                <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={load} />
              </Tooltip>
            ),
            key: "spacer",
            width: 60,
            align: "center",
            render: () => null,
          },
        ]}
      />
      </div>

      {latency.length > 0 && (
        <>
          <Text strong style={{ fontSize: 12 }}>Latency (LATENCY LATEST)</Text>
          <Table<Latency>
            size="small"
            rowKey="command"
            dataSource={latency}
            pagination={false}
            scroll={{ y: 200 }}
            columns={[
              { title: "Command", dataIndex: "command", render: (c: string) => <span className="mono" style={{ fontSize: 12 }}>{c}</span> },
              { title: "Latest (ms)", dataIndex: "latest", width: 120, align: "right", render: (v: number) => <span className="mono" style={{ fontSize: 12 }}>{(v / 1000).toFixed(1)}</span> },
              { title: "Max (ms)", dataIndex: "max", width: 120, align: "right", render: (v: number) => <span className="mono" style={{ fontSize: 12, color: v >= 100000 ? token.colorError : token.colorWarning }}>{(v / 1000).toFixed(1)}</span> },
            ]}
          />
        </>
      )}
    </div>
  );
}
