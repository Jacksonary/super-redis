import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Tooltip, Modal, Form, Input as InputField, Select, Popconfirm, message } from "antd";
import { ReloadOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { KeyInfo, SelectedTarget } from "../types";
import { api } from "../api";
import { formatBytes } from "../utils";

interface Props {
  target: SelectedTarget;
  onSelectKey: (key: string) => void;
}

const PAGE = 300;

export function KeyBrowser({ target, onSelectKey }: Props) {
  const { connectionId: connId, db } = target;
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [total, setTotal] = useState<number>(-1);
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [ttlKey, setTtlKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(
    async (p: string, c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.listKeys(connId, db, { pattern: p || undefined, cursor: c ? String(c) : undefined, count: PAGE });
        setKeys((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.cursor);
      } catch (e) {
        message.error(String(e));
      } finally {
        setLoading(false);
      }
    },
    [connId, db]
  );

  const refreshCount = useCallback(() => {
    api.getKeyCount(connId, db).then(setTotal).catch(() => {});
  }, [connId, db]);

  useEffect(() => {
    setKeys([]);
    setCursor(0);
    setPattern("");
    setSelectedRowKeys([]);
    setActiveKey(null);
    refreshCount();
    load("", 0, true);
  }, [connId, db, load, refreshCount]);

  const doDelete = async (keysToDelete: string[]) => {
    if (!keysToDelete.length) return;
    await api.deleteKeys(connId, db, keysToDelete);
    message.success(`deleted ${keysToDelete.length}`);
    setSelectedRowKeys([]);
    if (activeKey && keysToDelete.includes(activeKey)) {
      onSelectKey("");
      setActiveKey(null);
    }
    refreshCount();
    load(pattern, 0, true);
  };

  const doRename = async () => {
    if (!renameKey) return;
    try {
      const v = await form.validateFields();
      await api.renameKey(connId, db, renameKey, v.dst);
      message.success("renamed");
      setRenameKey(null);
      load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  const doTtl = async () => {
    if (!ttlKey) return;
    try {
      const v = await form.validateFields();
      const secs = Number(v.seconds);
      if (secs > 0) await api.expireKey(connId, db, ttlKey, secs);
      else await api.persistKey(connId, db, ttlKey);
      message.success("ttl updated");
      setTtlKey(null);
      load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  const doNew = async () => {
    try {
      const v = await form.validateFields();
      await api.createKey(connId, db, v.key, v.type);
      message.success("created");
      setNewOpen(false);
      refreshCount();
      load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  const columns = [
    {
      title: "Key",
      dataIndex: "key",
      ellipsis: true,
      render: (k: string, _r: KeyInfo, idx: number) => (
        <Space size={6}>
          <span style={{ fontSize: 12 }}>{k}</span>
        </Space>
      ),
    },
    { title: "Type", dataIndex: "type", width: 90, render: (t: string) => <span style={{ fontSize: 12 }}>{t}</span> },
    { title: "TTL", dataIndex: "ttl", width: 80, render: (t: number) => <span style={{ fontSize: 12 }}>{t}</span> },
    { title: "Size", dataIndex: "size", width: 90, render: (s: number | null) => <span style={{ fontSize: 12 }}>{formatBytes(s)}</span> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 8 }}>
      <Space style={{ marginBottom: 8 }}>
        <Input.Search
          placeholder="Search key (pattern)"
          allowClear
          prefix={<SearchOutlined />}
          style={{ width: 240 }}
          onChange={(e) => e.target.value === "" && setPattern("")}
          onSearch={(v) => {
            setPattern(v);
            load(v, 0, true);
            refreshCount();
          }}
        />
        <Tooltip title="Refresh">
          <Button icon={<ReloadOutlined />} onClick={() => load(pattern, 0, true)} />
        </Tooltip>
        <Tooltip title="New Key">
          <Button icon={<PlusOutlined />} onClick={() => setNewOpen(true)} />
        </Tooltip>
        {selectedRowKeys.length > 0 && (
          <Popconfirm title={`Delete ${selectedRowKeys.length}  keys?`} onConfirm={() => doDelete(selectedRowKeys)}>
            <Button danger size="small">Delete</Button>
          </Popconfirm>
        )}
      </Space>

      <div style={{ flex: 1, overflow: "auto" }}>
        <Table<KeyInfo>
          size="small"
          rowKey="key"
          columns={columns}
          dataSource={keys}
          loading={loading}
          pagination={false}
          rowSelection={{ selectedRowKeys, onChange: (k) => setSelectedRowKeys(k as string[]) }}
          onRow={(record) => ({
            onClick: () => {
              setActiveKey(record.key);
              onSelectKey(record.key);
            },
          })}
          rowClassName={(r) => (r.key === activeKey ? "ant-table-row-selected" : "")}
          scroll={{ y: "calc(100vh - 320px)" }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>
          {total >= 0 ? `Total ${total}  keys` : "..."}
        </span>
        {cursor !== 0 && (
          <Button size="small" loading={loading} onClick={() => load(pattern, cursor, false)}>
            Load more
          </Button>
        )}
      </div>

      <Modal open={newOpen} title="New Key" onOk={doNew} onCancel={() => setNewOpen(false)} okText="OK" cancelText="Cancel">
        <Form form={form} layout="vertical" size="small" preserve={false}>
          <Form.Item name="key" label="Key" rules={[{ required: true }]}>
            <InputField />
          </Form.Item>
          <Form.Item name="type" label="Type" initialValue="string">
            <Select
              options={["string", "hash", "list", "set", "zset"].map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!renameKey} title="Rename" onOk={doRename} onCancel={() => setRenameKey(null)} okText="OK" cancelText="Cancel">
        <Form form={form} layout="vertical" size="small" preserve={false}>
          <Form.Item name="dst" label="New name" rules={[{ required: true }]}>
            <InputField />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={!!ttlKey} title="Set TTL (seconds)" onOk={doTtl} onCancel={() => setTtlKey(null)} okText="OK" cancelText="Cancel">
        <Form form={form} layout="vertical" size="small" preserve={false}>
          <Form.Item name="seconds" label="Seconds (0 or empty = clear TTL)" initialValue={60} rules={[{ required: true }]}>
            <InputField type="number" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
