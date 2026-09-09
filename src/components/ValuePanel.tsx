import { useEffect, useState } from "react";
import { Button, Dropdown, Input, Spin, Tooltip, Typography, Modal, Space, theme } from "antd";
import { message, modal } from "../antd-app";
import { CopyOutlined, CheckOutlined, ReloadOutlined, DeleteOutlined, ClockCircleOutlined, LinkOutlined, CloseOutlined } from "@ant-design/icons";
import type { KeyInfo, SelectedTarget } from "../types";
import { api } from "../api";
import { StringViewer } from "./StringViewer";
import { HashViewer } from "./HashViewer";
import { ListViewer } from "./ListViewer";
import { SetViewer } from "./SetViewer";
import { ZSetViewer } from "./ZSetViewer";
import { StreamViewer } from "./StreamViewer";
import { TruncatedText } from "./TruncatedText";

const { Text } = Typography;

interface Props {
  target: SelectedTarget;
  currentKey: string;
  /** Read-only connection: suppress every key/value-writing action (TTL/delete/unlink). */
  readonly?: boolean;
  onDelete?: () => void;
  onMissing?: () => void;
}

export function ValuePanel({ target, currentKey, readonly = false, onDelete, onMissing }: Props) {
  const { connectionId: connId, db } = target;
  // Hooks must all run before any conditional return (the `loading` early-return
  // below) — themed token access lives here so the hook count stays stable.
  const { token } = theme.useToken();
  const [meta, setMeta] = useState<KeyInfo | null>(null);
  const [type, setType] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [ttlSecs, setTtlSecs] = useState("");
  const [ttlInvalid, setTtlInvalid] = useState(false);
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
    if (ttlInvalid) return;
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

  // Key-type family: string stays calm (the majority), the structured types each
  // get a distinct hue (from the --type-* CSS vars, which carry a tuned value per
  // theme) so the value panel telegraphs what it's showing.
  const TYPE_HUES: Record<string, string> = {
    string: "var(--type-string)",
    hash: "var(--type-hash)",
    list: "var(--type-list)",
    set: "var(--type-set)",
    zset: "var(--type-zset)",
    stream: "var(--type-stream)",
    ReJSON: "var(--type-rejson)",
  };
  const typeHue = TYPE_HUES[type] ?? "var(--type-string)";
  // TTL urgency: a key about to expire (<60s) flips to amber so it reads as a
  // signal; a persistent / timed-out one stays calm.
  const ttl = meta ? meta.ttl : undefined;
  const ttlHue = ttl !== undefined && ttl > 0 && ttl < 60 ? token.colorWarning : token.colorTextSecondary;

  const contextMenu = {
    items: [
      { key: "copy", label: "Copy key", icon: <CopyOutlined />, onClick: copyKey },
      { key: "refresh", label: "Refresh", icon: <ReloadOutlined />, onClick: refresh },
      { key: "ttl", label: "Set TTL", icon: <ClockCircleOutlined />, disabled: readonly, tooltip: readonly ? "Read-only connection" : undefined, onClick: () => { setTtlSecs(String(meta ? meta.ttl : "")); setTtlEditing(true); } },
      { type: "divider" as const },
      { key: "delete", label: "Delete key", icon: <DeleteOutlined />, danger: true, disabled: readonly, tooltip: readonly ? "Read-only connection" : undefined, onClick: confirmDelete },
    ],
  };

  return (
    <Dropdown menu={contextMenu} trigger={["contextMenu"]}>
      <div className="mono" style={{ padding: 12, height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Key takes the flexible remainder; Type/TTL size to their content. */}
        <span style={{ fontSize: 12, color: "inherit", flexShrink: 0 }}>Key:</span>
        <span
          onMouseEnter={() => setKeyHover(true)}
          onMouseLeave={() => setKeyHover(false)}
          style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, flex: "0 1 auto", overflow: "hidden" }}
        >
          <TruncatedText style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100%", flex: "1 1 auto", minWidth: 0 }}>{currentKey}</TruncatedText>
          <Button
            type="text"
            size="small"
            icon={<CopyOutlined />}
            style={{ opacity: keyHover ? 1 : 0.001, transition: "opacity .15s", flexShrink: 0 }}
            onClick={copyKey}
          />
        </span>
        <span style={{ fontSize: 12, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span>Type:</span>
          <span style={{ color: typeHue }}>{type || "none"}</span>
        </span>
        <span style={{ fontSize: 12, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
          TTL:{" "}
          {ttlEditing ? (
            <>
              <Input
                size="small"
                style={{ width: 70 }}
                value={ttlSecs}
                status={ttlInvalid ? "error" : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setTtlSecs(v);
                  // Empty (persist) or -1 (permanent) are allowed; otherwise a non-negative integer.
                  setTtlInvalid(v !== "" && v !== "-1" && !(Number.isInteger(Number(v)) && Number(v) >= 0));
                }}
                autoFocus
                onPressEnter={saveTtl}
                onBlur={() => setTtlEditing(false)}
              />
              <Button
                type="text"
                size="small"
                disabled={ttlInvalid}
                icon={<CheckOutlined />}
                onMouseDown={(e) => {
                  // mousedown fires before the input's blur, so save and keep the
                  // editing state (don't let blur cancel it first).
                  e.preventDefault();
                  void saveTtl();
                }}
              />
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onMouseDown={(e) => {
                  // Cancel: exit editing without saving.
                  e.preventDefault();
                  setTtlEditing(false);
                }}
              />
            </>
          ) : (
            <Button
              type="link"
              size="small"
              disabled={readonly}
              style={{ padding: 0, height: "auto", color: readonly ? token.colorTextDisabled : ttlHue }}
              onClick={() => {
                setTtlSecs(String(meta ? meta.ttl : ""));
                setTtlEditing(true);
              }}
            >
              {meta ? meta.ttl : "-"}
            </Button>
          )}
        </span>
        {/* Left group (Key/Type/TTL) hugs left; the action group hugs right. */}
        <div style={{ flex: 1 }} />
        <Space size={8} style={{ flexShrink: 0 }}>
          <Tooltip title="Refresh">
            <Button size="small" icon={<ReloadOutlined />} onClick={refresh} />
          </Tooltip>
          <Tooltip title={readonly ? "Delete (DEL) (read-only)" : "Delete (DEL)"}>
            <Button size="small" danger icon={<DeleteOutlined />} disabled={readonly} onClick={confirmDelete} />
          </Tooltip>
          {isLargeType && (
            <Tooltip title={readonly ? "Unlink (async, non-blocking) (read-only)" : "Unlink (async, non-blocking)"}>
              <Button size="small" danger icon={<LinkOutlined />} disabled={readonly} onClick={confirmUnlink} />
            </Tooltip>
          )}
        </Space>
      </div>

      {type === "string" && <StringViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} sizeBytes={meta?.size ?? undefined} readonly={readonly} />}
      {type === "hash" && <HashViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} readonly={readonly} />}
      {type === "list" && <ListViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} readonly={readonly} />}
      {type === "set" && <SetViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} readonly={readonly} />}
      {type === "zset" && <ZSetViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} readonly={readonly} />}
      {type === "stream" && <StreamViewer target={target} currentKey={currentKey} refreshSignal={refreshSignal} readonly={readonly} />}
      {type === "ReJSON" && <Text type="secondary">RedisJSON is coming in a later phase</Text>}
      </div>
    </Dropdown>
  );
}
