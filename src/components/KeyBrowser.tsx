import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Table, Tree, Input, Button, Space, Tooltip, Modal, Form, Input as InputField, Select, Segmented, Dropdown, theme } from "antd";
import { message, modal } from "../antd-app";
import { PlusOutlined, FolderOutlined, FolderOpenOutlined, UnorderedListOutlined, ApartmentOutlined, CopyOutlined, EditOutlined, HistoryOutlined, DeleteOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { groupKeys, type KeyTreeNode } from "../utils";

interface Props {
  target: SelectedTarget;
  delimiter: string;
  onSelectKey: (key: string) => void;
  reloadSignal?: number;
}

const PAGE = 300;

export function KeyBrowser({ target, delimiter, onSelectKey, reloadSignal }: Props) {
  const { token } = theme.useToken();
  const { connectionId: connId, db } = target;
  const [keys, setKeys] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

  const [view, setView] = useState<"flat" | "tree">("flat");
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  // Measure the list/tree area so it fills the available height adaptively
  // (instead of a hardcoded calc that can overflow or leave a gap).
  const fillRef = useRef<HTMLDivElement>(null);
  const [fillH, setFillH] = useState(400);
  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFillH(el.clientHeight));
    ro.observe(el);
    setFillH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const [newOpen, setNewOpen] = useState(false);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [ttlKey, setTtlKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  const treeData = useMemo<KeyTreeNode[]>(() => groupKeys(keys, delimiter), [keys, delimiter]);
  const keySet = useMemo(() => new Set(keys), [keys]);
  // Flat mode shows keys alphabetically (SCAN returns them unordered).
  const flatKeys = useMemo(
    () => (keys.length > 1 ? [...keys].sort((a, b) => a.localeCompare(b)) : keys),
    [keys]
  );

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

  useEffect(() => {
    setKeys([]);
    setCursor(0);
    setPattern("");
    setSelectedRowKeys([]);
    setActiveKey(null);
    load("", 0, true);
  }, [connId, db, load]);

  // External reload request (e.g. a selected key expired): refresh the list so
  // stale/expired keys disappear, without clobbering the current search.
  useEffect(() => {
    if (reloadSignal) load("", 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  const doDelete = async (keysToDelete: string[]) => {
    if (!keysToDelete.length) return;
    // Only real keys are selectable (folders are blocked in onCheck), so batch
    // delete is a plain DEL — same as the flat list.
    try {
      await api.deleteKeys(connId, db, keysToDelete);
      message.success(`deleted ${keysToDelete.length}`);
      setSelectedRowKeys([]);
      if (activeKey && keysToDelete.includes(activeKey)) {
        onSelectKey("");
        setActiveKey(null);
      }
      load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
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
        load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  // Left-click: select + open the detail view.
  const selectKey = (key: string) => {
    setActiveKey(key);
    setActiveFolder(null);
    onSelectKey(key);
  };

  // Right-click: highlight the row as the menu's subject, but do NOT open the
  // detail view (per desktop best practice — right-click only marks context).
  const highlightKey = (key: string) => {
    setActiveKey(key);
    setActiveFolder(null);
  };

  const contextMenu = (key: string) => ({
    items: [
      { key: "copy", label: "Copy key", icon: <CopyOutlined />, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); void navigator.clipboard.writeText(key); message.success("copied"); } },
      { key: "rename", label: "Rename", icon: <EditOutlined />, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); selectKey(key); setRenameKey(key); } },
      { key: "ttl", label: "Set TTL", icon: <HistoryOutlined />, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); selectKey(key); setTtlKey(key); } },
      { type: "divider" as const },
      { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); doDelete([key]); } },
    ],
  });

  const folderMenu = (folder: string) => ({
    items: [
      {
        key: "delete",
        label: "Delete all keys",
        icon: <DeleteOutlined />,
        danger: true,
        onClick: (info: { domEvent: { stopPropagation: () => void } }) => {
          // Stop the menu-item click from bubbling up to the tree node, which
          // would otherwise toggle the folder open/closed.
          info.domEvent.stopPropagation();
          modal.confirm({
            title: "Delete folder",
            content: `Delete all keys under "${folder}${delimiter}*"?`,
            okText: "Delete",
            cancelText: "Cancel",
            okButtonProps: { danger: true },
            onOk: async () => {
              try {
                const res = await api.deleteKeysByPattern(connId, db, `${folder}${delimiter}*`);
                message.success(`deleted ${res.deleted}`);
                setActiveFolder(null);
                load(pattern, 0, true);
              } catch (e) {
                message.error(String(e));
              }
            },
          });
        },
      },
    ],
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 8 }}>
      <div className="key-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Input.Search
          placeholder="Search key (pattern)"
          allowClear
          style={{ width: 190 }}
          onChange={(e) => e.target.value === "" && setPattern("")}
          onSearch={(v) => {
            setPattern(v);
            load(v, 0, true);
                  }}
        />
        <Segmented
          value={view}
          onChange={(v) => setView(v as "flat" | "tree")}
          options={[
            { value: "flat", label: "Flat", icon: <UnorderedListOutlined /> },
            { value: "tree", label: "Tree", icon: <ApartmentOutlined /> },
          ]}
        />
        <Tooltip title="New Key">
          <Button size="small" icon={<PlusOutlined />} onClick={() => setNewOpen(true)} />
        </Tooltip>
        <Tooltip title={`Delete ${selectedRowKeys.length} selected key(s)`}>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={selectedRowKeys.length === 0}
            onClick={() =>
              modal.confirm({
                title: `Delete ${selectedRowKeys.length} key(s)?`,
                okText: "Delete",
                cancelText: "Cancel",
                okButtonProps: { danger: true },
                onOk: () => doDelete(selectedRowKeys),
              })
            }
          />
        </Tooltip>
      </div>

      <div ref={fillRef} className="key-browser" style={{ flex: 1, minHeight: 0 }}>
        {view === "flat" ? (
          <Table<string>
            size="small"
            rowKey={(v) => v}
            virtual
            columns={[
              {
                title: "Key",
                align: "left",
                render: (_, v) => (
                  <Dropdown menu={contextMenu(v)} trigger={["contextMenu"]} onOpenChange={(open) => open && highlightKey(v)}>
                    <span className="mono" style={{ fontSize: 12, display: "block", userSelect: "none" }}>{v}</span>
                  </Dropdown>
                ),
              },
            ]}
            dataSource={flatKeys}
            loading={loading}
            pagination={false}
            rowSelection={{ columnWidth: 40, selectedRowKeys, onChange: (k) => setSelectedRowKeys(k as string[]) }}
            onRow={(record) => ({
              onClick: () => selectKey(record),
            })}
            rowClassName={(r) => (r === activeKey ? "ant-table-row-selected" : "")}
            scroll={{ y: fillH }}
          />
        ) : (
          <Tree
            className="key-tree"
            treeData={treeData}
            showLine={false}
            checkable
            checkStrictly
            checkedKeys={{ checked: selectedRowKeys, halfChecked: [] }}
            onCheck={(keys) => {
              const checked = (keys as { checked: string[] }).checked;
              // Folders are not selectable for batch delete — show a hint and keep
              // only real keys in the selection.
              const realChecked = checked.filter((k) => keySet.has(k));
              if (realChecked.length !== checked.length) {
                message.warning("Folders can't be selected — right-click a folder to delete it");
              }
              setSelectedRowKeys(realChecked);
            }}
            expandAction="click"
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as string[])}
            height={fillH}
            titleRender={(node) => {
              const key = node.key as string;
              const content = (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, userSelect: "none", width: "100%" }}>
                  {!node.isLeaf &&
                    (expandedKeys.includes(key) ? (
                      <FolderOpenOutlined style={{ color: token.colorWarning }} />
                    ) : (
                      <FolderOutlined style={{ color: token.colorWarning }} />
                    ))}
                  <span className="mono" style={{ fontSize: 12 }}>{node.title}</span>
                </span>
              );
              if (node.isLeaf) {
                return (
                  <Dropdown menu={contextMenu(key)} trigger={["contextMenu"]} onOpenChange={(open) => open && highlightKey(key)}>
                    {content}
                  </Dropdown>
                );
              }
              return (
                <Dropdown menu={folderMenu(key)} trigger={["contextMenu"]}>
                  {content}
                </Dropdown>
              );
            }}
            selectedKeys={activeKey ? [activeKey] : activeFolder ? [activeFolder] : []}
            onSelect={(_keys, info) => {
              const key = (info.node as unknown as { key: string }).key;
              if (!key) return;
              if (keySet.has(key)) {
                selectKey(key);
              } else {
                // A folder: tracking for the delete-folder action only; expand/collapse
                // is handled by expandAction (click on the node). Keep the right-hand
                // detail panel unchanged.
                setActiveFolder(key);
                setActiveKey(null);
              }
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
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
