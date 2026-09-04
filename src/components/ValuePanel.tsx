import { useEffect, useState } from "react";
import { Button, Descriptions, Dropdown, Input, Spin, Tooltip, Typography, Modal, Space } from "antd";
import { message, modal } from "../antd-app";
import { CopyOutlined, CheckOutlined, ReloadOutlined, DeleteOutlined, ClockCircleOutlined, LinkOutlined } from "@ant-design/icons";
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
  onDelete?: () => void;
  onMissing?: () => void;
}

export function ValuePanel({ target, currentKey, onDelete, onMissing }: Props) {
  const { connectionId: connId, db } = target;
  const [meta, setMeta] = useState<KeyInfo | null>(null);
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [ttlSecs, setTtlSecs] = useState("");
  const [keyHover, setKeyHover] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .getKeyInfo(connId, db, currentKey)
      .then((info) => {
        // An expired/removed key shows as TYPE "none" — don't show a dead detail
        // panel; go back to overview and let the list refresh it away.
        if (info.type === "none") {
          message.info(`Key "${currentKey}" no longer exists`);
          onMissing?.();
          return;
        }
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

  const refresh = () => {
    // Do NOT set `loading` here — that state drives the full-panel <Spin> on first
    // load, and reusing it would remount the whole detail area (reader sees a
    // full flash). Refresh only updates metadata and pokes the active viewer to
    // re-pull its value in place.
    api
      .getKeyInfo(connId, db, currentKey)
      .then((info) => {
        // Redis reports a missing key as TYPE "none" — surface it and go back to
        // the overview instead of refreshing a now-dead detail panel.
        if (info.type === "none") {
          message.info(`Key "${currentKey}" no longer exists`);
          onMissing?.();
          return;
        }
        setMeta(info);
        setType(info.type);
        // In-place refresh: bump the signal so the active viewer re-pulls its value
        // without a full remount.
        setRefreshSignal((s) => s + 1);
      })
      .catch((e) => message.error(String(e)));
  };

  const confirmDelete = () => {
    modal.confirm({
      title: "Delete key",
      content: `Delete "${currentKey}"? This cannot be undone.`,
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteKeys(connId, db, [currentKey]);
        message.success("deleted");
        onDelete?.();
      },
    });
  };

  const confirmUnlink = () => {
    modal.confirm({
      title: "Unlink key",
      content: `Unlink "${currentKey}"? Memory is freed asynchronously (non-blocking).`,
      okText: "Unlink",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.unlinkKeys(connId, db, [currentKey]);
        message.success("unlinked");
        onDelete?.();
      },
    });
  };

  // Large-value types can grow huge; offer async UNLINK (non-blocking) as an
  // alternative to a synchronous DEL that could stall the Redis event loop.
  const isLargeType = ["list", "set", "zset"].includes(type);

  const contextMenu = {
    items: [
      { key: "copy", label: "Copy key", icon: <CopyOutlined />, onClick: copyKey },
      { key: "refresh", label: "Refresh", icon: <ReloadOutlined />, onClick: refresh },
      { key: "ttl", label: "Set TTL", icon: <ClockCircleOutlined />, onClick: () => { setTtlSecs(String(meta ? meta.ttl : "")); setTtlEditing(true); } },
      { type: "divider" as const },
      { key: "delete", label: "Delete key", icon: <DeleteOutlined />, danger: true, onClick: confirmDelete },
    ],
  };

  return (
    <Dropdown menu={contextMenu} trigger={["contextMenu"]}>
      <div className="mono" style={{ padding: 12, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Descriptions size="small" column={4} style={{ fontSize: 12, flex: 1 }}>
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
                style={{ width: 70 }}
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
        <Space size={8} style={{ flexShrink: 0 }}>
          <Tooltip title="Refresh">
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh} />
          </Tooltip>
          <Tooltip title="Delete (DEL)">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={confirmDelete} />
          </Tooltip>
          {isLargeType && (
            <Tooltip title="Unlink (async, non-blocking)">
              <Button size="small" danger icon={<LinkOutlined />} onClick={confirmUnlink} />
            </Tooltip>
          )}
        </Space>
      </div>

      {type === "string" && <StringViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "hash" && <HashViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "list" && <ListViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "set" && <SetViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "zset" && <ZSetViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "stream" && <StreamViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} />}
      {type === "ReJSON" && <Text type="secondary">RedisJSON is coming in a later phase</Text>}
      </div>
    </Dropdown>
  );
}
