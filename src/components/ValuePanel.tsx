import { useEffect, useState } from "react";
import { Button, Descriptions, Input, Spin, Typography, message } from "antd";
import { CopyOutlined, CheckOutlined } from "@ant-design/icons";
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
  const [ttlEditing, setTtlEditing] = useState(false);
  const [ttlSecs, setTtlSecs] = useState("");
  const [keyHover, setKeyHover] = useState(false);

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

  const saveTtl = async () => {
    const secs = Number(ttlSecs);
    if (Number.isNaN(secs)) return;
    try {
      if (secs > 0) await api.expireKey(connId, db, currentKey, secs);
      else await api.persistKey(connId, db, currentKey);
      message.success("ttl updated");
      setMeta((m) => (m ? { ...m, ttl: secs > 0 ? secs : -1 } : m));
    } finally {
      setTtlEditing(false);
    }
  };

  if (loading) return <Spin style={{ margin: 40 }} />;

  return (
    <div style={{ padding: 12, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 12, fontFamily: "SF Mono, Menlo, monospace" }}>
      <Descriptions size="small" column={4} style={{ fontSize: 12 }}>
        <Descriptions.Item label="Key">
          <span
            onMouseEnter={() => setKeyHover(true)}
            onMouseLeave={() => setKeyHover(false)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            {currentKey}
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              style={{ opacity: keyHover ? 1 : 0.001, transition: "opacity .15s" }}
              onClick={copyKey}
            />
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="Type">{type || "none"}</Descriptions.Item>
        <Descriptions.Item label="TTL">
          {ttlEditing ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Input
                size="small"
                style={{ width: 90 }}
                value={ttlSecs}
                onChange={(e) => setTtlSecs(e.target.value)}
                autoFocus
                onPressEnter={saveTtl}
              />
              <Button type="text" size="small" icon={<CheckOutlined />} onClick={saveTtl} />
            </span>
          ) : (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={() => {
                setTtlSecs(String(meta ? meta.ttl : ""));
                setTtlEditing(true);
              }}
            >
              {meta ? meta.ttl : "-"}
            </Button>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Size">{meta ? formatBytes(meta.size) : "-"}</Descriptions.Item>
      </Descriptions>

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
