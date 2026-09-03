import { useEffect, useMemo, useState } from "react";
import { Card, Row, Col, Table, Input, Button, Typography, message } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";

const { Text } = Typography;

type Sections = Record<string, Record<string, unknown>>;

function pick(sections: Sections | null, sec: string, key: string): string {
  const v = sections?.[sec]?.[key];
  return v == null ? "-" : String(v);
}

// (label, info-section, info-key) per card, one line each.
const SERVER: [string, string, string][] = [
  ["Redis version", "server", "redis_version"],
  ["OS", "server", "os"],
  ["Process ID", "server", "process_id"],
];
const MEMORY: [string, string, string][] = [
  ["Used Memory", "memory", "used_memory_human"],
  ["Used Memory Peak", "memory", "used_memory_peak_human"],
  ["Used Memory Lua", "memory", "used_memory_lua_human"],
];
const STATS: [string, string, string][] = [
  ["Connected Clients", "clients", "connected_clients"],
  ["Total Connections", "stats", "total_connections_received"],
  ["Total Commands", "stats", "total_commands_processed"],
];

function CardList({ title, items, sections }: { title: string; items: [string, string, string][]; sections: Sections | null }) {
  return (
    <Card size="small" title={title}>
      {items.map(([label, section, key]) => (
        <div key={`${section}.${key}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{label}:</Text>
          <Text style={{ fontSize: 12 }}>{pick(sections, section, key)}</Text>
        </div>
      ))}
    </Card>
  );
}

export function ConnInfoPanel({ target }: { target: SelectedTarget }) {
  const [sections, setSections] = useState<Sections | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = () => {
    setLoading(true);
    api
      .getServerInfo(target.connectionId)
      .then((r) => setSections(r as Sections))
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [target.connectionId]);

  const keyspaceRows = useMemo(() => {
    const raw = (sections?.keyspace ?? {}) as Record<string, string>;
    return Object.entries(raw).map(([db, val]) => {
      const m = /keys=(\d+),expires=(\d+),avg_ttl=(-?\d+)/.exec(String(val));
      return { db, keys: m?.[1], expires: m?.[2], avgTtl: m?.[3] };
    });
  }, [sections]);

  const allRows = useMemo(() => {
    const rows: { key: string; value: string }[] = [];
    if (!sections) return rows;
    for (const [sec, obj] of Object.entries(sections)) {
      if (sec === "keyspace" || sec === "all" || sec === "commandstats" || sec === "latencystats") continue;
      for (const [k, v] of Object.entries(obj || {})) {
        rows.push({ key: `${sec}.${k}`, value: String(v) });
      }
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  }, [sections]);

  const filtered = useMemo(() => {
    const lower = q.trim().toLowerCase();
    if (!lower) return allRows;
    return allRows.filter((r) => r.key.toLowerCase().includes(lower) || r.value.toLowerCase().includes(lower));
  }, [allRows, q]);

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Text strong style={{ fontSize: 14 }}>Overview</Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </div>

      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}><CardList title="Server" items={SERVER} sections={sections} /></Col>
        <Col xs={24} md={8}><CardList title="Memory" items={MEMORY} sections={sections} /></Col>
        <Col xs={24} md={8}><CardList title="Stats" items={STATS} sections={sections} /></Col>
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

      <Card
        size="small"
        title="All Redis Info"
        style={{ marginTop: 12 }}
        extra={
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search key or value"
            style={{ width: 220 }}
            onChange={(e) => setQ(e.target.value)}
            value={q}
          />
        }
      >
        <Table
          size="small"
          rowKey="key"
          pagination={{ pageSize: 50, size: "small" }}
          dataSource={filtered}
          loading={loading}
          columns={[
            { title: "Key", dataIndex: "key", width: 280, render: (k: string) => <Text style={{ fontSize: 11.5, fontFamily: "monospace" }}>{k}</Text> },
            { title: "Value", dataIndex: "value", render: (v: string) => <Text style={{ fontSize: 11.5 }}>{v}</Text> },
          ]}
        />
      </Card>
    </div>
  );
}
