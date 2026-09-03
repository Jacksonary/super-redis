import { useCallback, useEffect, useMemo, useState } from "react";
import { Table, Tree, Input, Button, Space, Tooltip, Modal, Form, Input as InputField, Select, Segmented, Popconfirm, message } from "antd";
import { ReloadOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { groupKeys, type KeyTreeNode } from "../utils";

interface Props {
  target: SelectedTarget;
  onSelectKey: (key: string) => void;
}

const PAGE = 300;

export function KeyBrowser({ target, onSelectKey }: Props) {
  const { connectionId: connId, db } = target;
  const [keys, setKeys] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [total, setTotal] = useState<number>(-1);
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  const [view, setView] = useState<"flat" | "tree">("flat");
  const [delimiter, setDelimiter] = useState(":");
  const [loadingAll, setLoadingAll] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [ttlKey, setTtlKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  const treeData = useMemo<KeyTreeNode[]>(() => groupKeys(keys, delimiter), [keys, delimiter]);
  const keySet = useMemo(() => new Set(keys), [keys]);

  const load = useCallback(
    async (p: string, c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.listKeys(connId, db, { pattern: p || undefined, cursor: c ? String(c) : undefined, count: PAGE });
        setKeys((prev) => (reset ? res.keys : [...prev, ...res.keys]));
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

  // "Load all keys" for the tree view: page through SCAN until the cursor ends.
  const loadAll = async () => {
    setLoadingAll(true);
    let c = 0;
    let acc: string[] = [];
    try {
      for (;;) {
        const res = await api.listKeys(connId, db, { pattern: pattern || undefined, cursor: c ? String(c) : undefined, count: 500 });
        acc = acc.concat(res.keys);
        c = res.cursor;
        if (!c || acc.length > 20000) break;
      }
      setKeys(acc);
    } catch (e) {
      message.error(String(e));
    } finally {
      setLoadingAll(false);
    }
  };

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
      await api.createKey(connId, db, v.key, v.type, {
        value: v.value,
        field: v.field,
        score: Number(v.score),
        ttl: v.ttl ? Number(v.ttl) : undefined,
      });
      message.success("created");
      setNewOpen(false);
      refreshCount();
      load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Input.Search
          placeholder="Search key (pattern)"
          allowClear
          prefix={<SearchOutlined />}
          style={{ width: 190 }}
          onChange={(e) => e.target.value === "" && setPattern("")}
          onSearch={(v) => {
            setPattern(v);
            load(v, 0, true);
            refreshCount();
          }}
        />
        <Segmented value={view} onChange={(v) => setView(v as "flat" | "tree")} options={["flat", "tree"]} />
        <Tooltip title="Refresh">
          <Button icon={<ReloadOutlined />} onClick={() => load(pattern, 0, true)} />
        </Tooltip>
        <Tooltip title="New Key">
          <Button icon={<PlusOutlined />} onClick={() => setNewOpen(true)} />
        </Tooltip>
        {selectedRowKeys.length > 0 && (
          <Popconfirm title={`Delete ${selectedRowKeys.length} keys?`} onConfirm={() => doDelete(selectedRowKeys)}>
            <Button danger size="small">Delete</Button>
          </Popconfirm>
        )}
      </div>

      {view === "tree" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Separator:</span>
          <Input
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value || ":")}
            style={{ width: 64 }}
            placeholder=":"
          />
          <Button size="small" loading={loadingAll} onClick={loadAll}>Load all keys</Button>
          {activeFolder && (
            <Popconfirm
              title={`Delete all keys under "${activeFolder}${delimiter}*"?`}
              onConfirm={async () => {
                const res = await api.deleteKeysByPattern(connId, db, `${activeFolder}${delimiter}*`);
                message.success(`deleted ${res.deleted}`);
                setActiveFolder(null);
                refreshCount();
                load(pattern, 0, true);
              }}
            >
              <Button size="small" danger>Delete folder</Button>
            </Popconfirm>
          )}
        </div>
      )}

      {view === "flat" ? (
        <div style={{ flex: 1, overflow: "auto" }}>
          <Table<string>
            size="small"
            rowKey={(v) => v}
            virtual
            columns={[
              {
                title: "Key",
                align: "left",
                render: (_, v) => <span style={{ fontSize: 12, fontFamily: "SF Mono, Menlo, monospace" }}>{v}</span>,
              },
            ]}
            dataSource={keys}
            loading={loading}
            pagination={false}
            rowSelection={{ columnWidth: 40, selectedRowKeys, onChange: (k) => setSelectedRowKeys(k as string[]) }}
            onRow={(record) => ({
              onClick: () => {
                setActiveKey(record);
                onSelectKey(record);
              },
            })}
            rowClassName={(r) => (r === activeKey ? "ant-table-row-selected" : "")}
            scroll={{ y: "calc(100vh - 240px)" }}
          />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
          <Tree
            treeData={treeData}
            showLine
            showIcon={false}
            height={Math.max(320, window.innerHeight - 230)}
            selectedKeys={activeKey ? [activeKey] : activeFolder ? [activeFolder] : []}
            onSelect={(_keys, info) => {
              const key = (info.node as unknown as { key: string }).key;
              if (!key) return;
              if (keySet.has(key)) {
                setActiveKey(key);
                setActiveFolder(null);
                onSelectKey(key);
              } else {
                setActiveFolder(key);
                setActiveKey(null);
                onSelectKey("");
              }
            }}
          />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8 }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{total >= 0 ? `${total} keys` : "..."}</span>
        {cursor !== 0 && (
          <Button size="small" loading={loading} onClick={() => load(pattern, cursor, false)}>
            Load more
          </Button>
        )}
      </div>

      <Modal open={newOpen} title="New Key" onOk={doNew} onCancel={() => setNewOpen(false)} okText="OK" cancelText="Cancel" width={480}>
        <NewKeyForm form={form} />
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
          <Form.Item name="seconds" label="Seconds (0 or empty = remove expiry)" initialValue={60} rules={[{ required: true }]}>
            <InputField type="number" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function NewKeyForm({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  const type = Form.useWatch("type", form) || "string";
  return (
    <Form form={form} layout="vertical" size="small" preserve={false}>
      <Form.Item name="key" label="Key" rules={[{ required: true }]}>
        <InputField />
      </Form.Item>
      <Form.Item name="type" label="Type" initialValue="string">
        <Select options={["string", "hash", "list", "set", "zset"].map((t) => ({ value: t, label: t }))} />
      </Form.Item>
      {type === "string" && (
        <Form.Item name="value" label="Value">
          <InputField />
        </Form.Item>
      )}
      {type === "hash" && (
        <>
          <Form.Item name="field" label="Field">
            <InputField />
          </Form.Item>
          <Form.Item name="value" label="Value">
            <InputField />
          </Form.Item>
        </>
      )}
      {(type === "list" || type === "set") && (
        <Form.Item name="value" label={type === "set" ? "Member" : "Item value"}>
          <InputField />
        </Form.Item>
      )}
      {type === "zset" && (
        <>
          <Form.Item name="score" label="Score" initialValue={0}>
            <InputField type="number" />
          </Form.Item>
          <Form.Item name="value" label="Member">
            <InputField />
          </Form.Item>
        </>
      )}
      <Form.Item name="ttl" label="TTL (seconds, optional)">
        <InputField type="number" />
      </Form.Item>
    </Form>
  );
}
