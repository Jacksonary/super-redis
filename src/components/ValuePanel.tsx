import { useEffect, useState } from "react";
import { Button, Descriptions, Input, Modal, Space, Spin, Tooltip, Typography, message } from "antd";
import { CopyOutlined, ClockCircleOutlined } from "@ant-design/icons";
import type { KeyInfo, SelectedTarget } from "../types";
import { api } from "../api";
import { formatBytes } from "../utils";
import { StringViewer } from "./StringViewer";
import { HashViewer } from "./HashViewer";
import { ListViewer } from "./ListViewer";
import { SetViewer } from "./SetViewer";
import { ZSetViewer } from "./ZSetViewer";
import { StreamViewer } from "./StreamViewer";

const { Text } = Typography;

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

export function ValuePanel({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [meta, setMeta] = useState<KeyInfo | null>(null);
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [ttlOpen, setTtlOpen] = useState(false);
  const [ttlSecs, setTtlSecs] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .getKeyInfo(connId, db, currentKey)
      .then((info) => {
        setMeta(info);
        setType(info.type);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [connId, db, currentKey]);

  const copyKey = async () => {
    await navigator.clipboard.writeText(currentKey);
    message.success("copied");
  };

  const setTtl = async () => {
    const secs = Number(ttlSecs);
    if (secs > 0) await api.expireKey(connId, db, currentKey, secs);
    else await api.persistKey(connId, db, currentKey);
    message.success("ttl updated");
    setTtlOpen(false);
    setMeta((m) => (m ? { ...m, ttl: secs > 0 ? secs : -1 } : m));
  };

  if (loading) return <Spin style={{ margin: 40 }} />;

  return (
    <div style={{ padding: 12, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 12, fontFamily: "SF Mono, Menlo, monospace" }}>
      <Space size={8}>
        <Tooltip title="Copy key">
          <Button size="small" icon={<CopyOutlined />} onClick={copyKey} />
        </Tooltip>
        <Tooltip title="Set TTL">
          <Button size="small" icon={<ClockCircleOutlined />} onClick={() => setTtlOpen(true)} />
        </Tooltip>
        <Descriptions size="small" column={4} style={{ fontSize: 12 }}>
          <Descriptions.Item label="Key">{currentKey}</Descriptions.Item>
          <Descriptions.Item label="Type">{type || "none"}</Descriptions.Item>
          <Descriptions.Item label="TTL">{meta ? meta.ttl : "-"}</Descriptions.Item>
          <Descriptions.Item label="Size">{meta ? formatBytes(meta.size) : "-"}</Descriptions.Item>
        </Descriptions>
      </Space>

      <Modal open={ttlOpen} title="Set TTL (seconds)" okText="OK" cancelText="Cancel" onOk={setTtl} onCancel={() => setTtlOpen(false)}>
        <Input
          type="number"
          value={ttlSecs}
          onChange={(e) => setTtlSecs(e.target.value)}
          placeholder="Seconds (0 = remove expiry)"
          autoFocus
        />
      </Modal>

      {type === "string" && <StringViewer target={target} currentKey={currentKey} />}
      {type === "hash" && <HashViewer target={target} currentKey={currentKey} />}
      {type === "list" && <ListViewer target={target} currentKey={currentKey} />}
      {type === "set" && <SetViewer target={target} currentKey={currentKey} />}
      {type === "zset" && <ZSetViewer target={target} currentKey={currentKey} />}
      {type === "stream" && <StreamViewer target={target} currentKey={currentKey} />}
      {type === "ReJSON" && <Text type="secondary">RedisJSON is coming in a later phase</Text>}
    </div>
  );
}
