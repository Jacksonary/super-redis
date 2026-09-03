import { useEffect, useMemo, useState } from "react";
import { Card, Row, Col, Statistic, Table, Typography, message } from "antd";
import type { SelectedTarget } from "../types";
import { api } from "../api";

const { Text } = Typography;

type Sections = Record<string, Record<string, unknown>>;

function pick(sections: Sections | null, sec: string, key: string): string {
  const v = sections?.[sec]?.[key];
  return v == null ? "-" : String(v);
}

export function ConnInfoPanel({ target }: { target: SelectedTarget }) {
  const [sections, setSections] = useState<Sections | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getServerInfo(target.connectionId)
      .then((r) => setSections(r as Sections))
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [target.connectionId]);

  const keyspaceRows = useMemo(() => {
    const raw = (sections?.keyspace ?? {}) as Record<string, string>;
    return Object.entries(raw).map(([db, val]) => {
      const m = /keys=(\d+),expires=(\d+),avg_ttl=(-?\d+)/.exec(String(val));
      return { db, keys: m?.[1], expires: m?.[2], avgTtl: m?.[3], raw: String(val) };
    });
  }, [sections]);

  const allRows = useMemo(() => {
    const rows: { key: string; value: string }[] = [];
    if (!sections) return rows;
    for (const [sec, obj] of Object.entries(sections)) {
      if (sec === "keyspace") continue;
      for (const [k, v] of Object.entries(obj || {})) {
        rows.push({ key: `${sec}.${k}`, value: String(v) });
      }
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [sections]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12 }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card size="small" title="Server">
            <Statistic title="Redis version" value={pick(sections, "server", "redis_version")} />
            <Statistic title="OS" value={pick(sections, "server", "os")} />
            <Statistic title="Process ID" value={pick(sections, "server", "process_id")} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Memory">
            <Statistic title="Used Memory" value={pick(sections, "memory", "used_memory_human")} />
            <Statistic title="Used Memory Peak" value={pick(sections, "memory", "used_memory_peak_human")} />
            <Statistic title="Used Memory Lua" value={pick(sections, "memory", "used_memory_lua_human")} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="Stats">
            <Statistic title="Connected Clients" value={pick(sections, "clients", "connected_clients")} />
            <Statistic title="Total Connections" value={pick(sections, "stats", "total_connections_received")} />
            <Statistic title="Total Commands" value={pick(sections, "stats", "total_commands_processed")} />
          </Card>
        </Col>
      </Row>

      {keyspaceRows.length > 0 && (
        <Card size="small" title="Key Statistics" style={{ marginTop: 12 }}>
          <Table
            size="small"
            rowKey="db"
            pagination={false}
            dataSource={keyspaceRows}
            columns={[
              { title: "DB", dataIndex: "db" },
              { title: "Keys", dataIndex: "keys" },
              { title: "Expires", dataIndex: "expires" },
              { title: "Avg TTL", dataIndex: "avgTtl" },
            ]}
          />
        </Card>
      )}

      <Card size="small" title="All Redis Info" style={{ marginTop: 12 }}>
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 50, size: "small" }}
          dataSource={allRows}
          loading={loading}
          columns={[
            { title: "Key", dataIndex: "key", width: 280, render: (k: string) => <Text style={{ fontSize: 12, fontFamily: "monospace" }}>{k}</Text> },
            { title: "Value", dataIndex: "value", render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
          ]}
        />
      </Card>
    </div>
  );
}
