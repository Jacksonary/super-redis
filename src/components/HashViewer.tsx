import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Modal, message } from "antd";
import type { HashField, SelectedTarget } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

const PAGE = 300;

export function HashViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [fields, setFields] = useState<HashField[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<HashField | null>(null);
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getHashFields(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setFields((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.total);
      } catch (e) {
        message.error(String(e));
      } finally {
        setLoading(false);
      }
    },
    [connId, db, currentKey]
  );

  useEffect(() => {
    setFields([]);
    setNewField("");
    setNewValue("");
    load(0, true);
  }, [connId, db, currentKey, load]);

  const doAdd = async () => {
    if (!newField) return;
    await api.setHashField(connId, db, currentKey, newField, newValue);
    message.success("added");
    setAddOpen(false);
    setNewField("");
    setNewValue("");
    load(0, true);
  };

  const doEdit = async () => {
    if (!editing) return;
    await api.setHashField(connId, db, currentKey, editing.field, editing.value);
    message.success("saved");
    setEditing(null);
    load(0, true);
  };

  const remove = async (f: string) => {
    await api.deleteHashField(connId, db, currentKey, [f]);
    message.success("deleted");
    load(0, true);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <Space>
        <Button size="small" type="primary" onClick={() => setAddOpen(true)}>Add field</Button>
        {cursor !== 0 && (
          <Button size="small" onClick={() => load(cursor, false)} disabled={loading}>Load more</Button>
        )}
      </Space>
      <Table<HashField>
        size="small"
        rowKey="field"
        columns={[
          { title: "Field", dataIndex: "field", ellipsis: true },
          { title: "Value", dataIndex: "value", render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "Actions",
            width: 120,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => setEditing({ ...r })}>Edit</Button>
                <Button size="small" type="link" danger onClick={() => remove(r.field)}>Delete</Button>
              </Space>
            ),
          },
        ]}
        dataSource={fields}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 340px)" }}
      />

      <Modal open={addOpen} title="Add field" okText="OK" cancelText="Cancel" onOk={doAdd} onCancel={() => setAddOpen(false)}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input placeholder="field" value={newField} onChange={(e) => setNewField(e.target.value)} />
          <Input placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </Space>
      </Modal>

      <Modal open={!!editing} title={`Edit: ${editing?.field}`} okText="Save" cancelText="Cancel" onOk={doEdit} onCancel={() => setEditing(null)}>
        <Input
          placeholder="value"
          value={editing?.value ?? ""}
          onChange={(e) => setEditing((p) => (p ? { ...p, value: e.target.value } : p))}
        />
      </Modal>
    </div>
  );
}
