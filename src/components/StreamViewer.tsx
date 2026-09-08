import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Modal, Tooltip, theme } from "antd";
import { message, modal } from "../antd-app";
import { DeleteOutlined } from "@ant-design/icons";
import type { SelectedTarget, StreamEntry } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
}

export function StreamViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const { token } = theme.useToken();
  const [entries, setEntries] = useState<StreamEntry[]>([]);
  const [groups, setGroups] = useState<{ name: string; consumers: number; pending: number; last_delivered_id: string }[]>([]);
  const [length, setLength] = useState(0);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [fieldsText, setFieldsText] = useState("field1 value1\nfield2 value2");
  const [groupName, setGroupName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getStreamInfo(connId, db, currentKey);
      setEntries(res.entries);
      setGroups(res.groups ?? []);
      setLength(res.length);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [connId, db, currentKey]);

  useEffect(() => {
    load();
  }, [connId, db, currentKey, load, refreshSignal]);

  const addEntry = async () => {
    const pairs = fieldsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const fields: Record<string, string> = {};
    for (const line of pairs) {
      const [k, ...rest] = line.split(/\s+/);
      if (k) fields[k] = rest.join(" ") || "";
    }
    await api.addStreamEntry(connId, db, currentKey, fields);
    message.success("added");
    setAddOpen(false);
    load();
  };

  const remove = async (id: string) => {
    await api.deleteStreamEntry(connId, db, currentKey, [id]);
    message.success("deleted");
    load();
  };

  const confirmRemove = (id: string) => {
    modal.confirm({
      title: "Delete entry",
      content: "Delete this stream entry?",
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: () => remove(id),
    });
  };

  const createGroup = async () => {
    if (!groupName) return;
    await api.createConsumerGroup(connId, db, currentKey, groupName);
    message.success("group created");
    setGroupOpen(false);
    setGroupName("");
    load();
  };

  return (
    <div className="value-viewer" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <Space>
        <span style={{ fontSize: 12, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>Length: {length}</span>
        <Button size="small" type="primary" onClick={() => setAddOpen(true)}>Add entry</Button>
        <Button size="small" onClick={() => setGroupOpen(true)}>New group</Button>
        <Button size="small" onClick={load}>Refresh</Button>
      </Space>
      {groups.length > 0 && (
        <Space size={12} wrap style={{ fontSize: 11 }}>
          {groups.map((g) => {
            const pendColor = g.pending === 0 ? token.colorSuccess : g.pending >= length ? token.colorError : token.colorWarning;
            return (
              <span key={g.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: pendColor, flexShrink: 0 }} />
                <Tooltip title={g.name}>
                  <span className="mono" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</span>
                </Tooltip>
                <span style={{ color: token.colorTextTertiary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{g.pending} pending</span>
              </span>
            );
          })}
        </Space>
      )}
      <Table<StreamEntry>
        size="small"
        rowKey="id"
        columns={[
          { title: "ID", dataIndex: "id", width: 130, render: (id: string) => <span className="mono" style={{ fontSize: 12 }}>{id}</span> },
          {
            title: "Fields",
            dataIndex: "fields",
            ellipsis: true,
            render: (f: [string, string][]) => (
              <Tooltip title={f.map(([k, v]) => `${k}=${v}`).join("\n")}>
                <span style={{ fontSize: 12 }}>{f.map(([k, v]) => `${k}=${v}`).join("  ")}</span>
              </Tooltip>
            ),
          },
          {
            title: "Actions",
            width: 70,
            render: (_, r) => (
              <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => confirmRemove(r.id)} />
            ),
          },
        ]}
        dataSource={entries}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 360px)" }}
      />

      <Modal open={addOpen} title="Add entry" okText="OK" cancelText="Cancel" onOk={addEntry} onCancel={() => setAddOpen(false)}>
        <Input.TextArea
          value={fieldsText}
          onChange={(e) => setFieldsText(e.target.value)}
          rows={5}
          placeholder={"field1 value1\nfield2 value2"}
          className="mono"
          style={{ fontSize: 12 }}
        />
      </Modal>

      <Modal open={groupOpen} title="New consumer group" okText="OK" cancelText="Cancel" onOk={createGroup} onCancel={() => setGroupOpen(false)}>
        <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="group name" />
      </Modal>
    </div>
  );
}
