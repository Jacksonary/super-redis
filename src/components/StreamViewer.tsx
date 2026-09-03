import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Modal, Popconfirm, message } from "antd";
import type { SelectedTarget, StreamEntry } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

export function StreamViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [entries, setEntries] = useState<StreamEntry[]>([]);
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
      setLength(res.length);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [connId, db, currentKey]);

  useEffect(() => {
    load();
  }, [connId, db, currentKey, load]);

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

  const createGroup = async () => {
    if (!groupName) return;
    await api.createConsumerGroup(connId, db, currentKey, groupName);
    message.success("group created");
    setGroupOpen(false);
    setGroupName("");
    load();
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <Space>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Length: {length}</span>
        <Button size="small" type="primary" onClick={() => setAddOpen(true)}>Add entry</Button>
        <Button size="small" onClick={() => setGroupOpen(true)}>New group</Button>
        <Button size="small" onClick={load}>Refresh</Button>
      </Space>
      <Table<StreamEntry>
        size="small"
        rowKey="id"
        columns={[
          { title: "ID", dataIndex: "id", width: 130, render: (id: string) => <span style={{ fontSize: 12, fontFamily: "monospace" }}>{id}</span> },
          {
            title: "Fields",
            dataIndex: "fields",
            render: (f: [string, string][]) => (
              <span style={{ fontSize: 12 }}>
                {f.map(([k, v]) => `${k}=${v}`).join("  ")}
              </span>
            ),
          },
          {
            title: "Actions",
            width: 90,
            render: (_, r) => (
              <Popconfirm title="Delete entry?" onConfirm={() => remove(r.id)}>
                <Button size="small" type="link" danger>Delete</Button>
              </Popconfirm>
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
          style={{ fontFamily: "monospace", fontSize: 12.5 }}
        />
      </Modal>

      <Modal open={groupOpen} title="New consumer group" okText="OK" cancelText="Cancel" onOk={createGroup} onCancel={() => setGroupOpen(false)}>
        <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="group name" />
      </Modal>
    </div>
  );
}
