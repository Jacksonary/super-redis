import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Modal, Tooltip } from "antd";
import { SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { HashField, SelectedTarget } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
}

const PAGE = 300;

export function HashViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const [fields, setFields] = useState<HashField[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ origField: string; field: string; value: string } | null>(null);
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getHashFields(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setFields((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.cursor);
        setTotal(res.total);
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
  }, [connId, db, currentKey, load, refreshSignal]);

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
    await api.renameHashField(connId, db, currentKey, editing.origField, editing.field, editing.value);
    message.success("saved");
    setEditing(null);
    load(0, true);
  };

  const remove = (f: string) => {
    modal.confirm({
      title: "Delete field",
      content: `Delete "${f}"?`,
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteHashField(connId, db, currentKey, [f]);
        message.success("deleted");
        load(0, true);
      },
    });
  };

  const doSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) {
      load(0, true);
      return;
    }
    setLoading(true);
    try {
      const res = await api.searchHashField(connId, db, currentKey, q);
      setFields(res.items);
      setCursor(0);
      setTotal(res.total);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="value-viewer" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Space>
          <Button size="small" type="primary" onClick={() => setAddOpen(true)}>Add field</Button>
          {cursor !== 0 && (
            <Button size="small" onClick={() => load(cursor, false)} disabled={loading}>Load more</Button>
          )}
        </Space>
        <div style={{ flex: 1 }} />
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search field"
          style={{ width: 180 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => doSearch(search)}
        />
      </div>
      <Table<HashField>
        size="small"
        rowKey="field"
        columns={[
          { title: <span>Field (Total: {total})</span>, dataIndex: "field", ellipsis: true },
          { title: "Value", dataIndex: "value", render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, r) => (
              <Space size={4}>
                <Tooltip title="Edit">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing({ origField: r.field, field: r.field, value: r.value })} />
                </Tooltip>
                <Tooltip title="Delete">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r.field)} />
                </Tooltip>
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

      <Modal open={!!editing} title={`Edit: ${editing?.origField}`} okText="Save" cancelText="Cancel" onOk={doEdit} onCancel={() => setEditing(null)}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            placeholder="field"
            value={editing?.field ?? ""}
            onChange={(e) => setEditing((p) => (p ? { ...p, field: e.target.value } : p))}
          />
          <Input
            placeholder="value"
            value={editing?.value ?? ""}
            onChange={(e) => setEditing((p) => (p ? { ...p, value: e.target.value } : p))}
          />
        </Space>
      </Modal>
    </div>
  );
}
