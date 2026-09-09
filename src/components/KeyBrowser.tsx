import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from "react";
import { Table, TableColumnsType, Tree, Input, Button, Space, Tooltip, Modal, Form, Input as InputField, Select, Segmented, Dropdown, Row, Col, InputNumber, theme } from "antd";
import { message, modal } from "../antd-app";
import { PlusOutlined, FolderOutlined, FolderOpenOutlined, UnorderedListOutlined, ApartmentOutlined, CopyOutlined, EditOutlined, HistoryOutlined, DeleteOutlined, DownOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { groupKeys, type KeyTreeNode } from "../utils";
import { TruncatedText } from "./TruncatedText";

interface Props {
  target: SelectedTarget;
  delimiter: string;
  onSelectKey: (key: string) => void;
  reloadSignal?: number;
  /** Read-only connection: suppress every key-writing action (new/rename/TTL/delete). */
  readonly?: boolean;
  isDark?: boolean;
}

const PAGE = 300;

// New-key types, in the order shown in the title-bar type picker. The hues are
// the SAME palette as the value panel's --type-* CSS vars, but hardcoded hex here
// because the dropdown menu renders in a portal OUTSIDE `<div data-theme>`, where
// the CSS vars are undefined. Each theme keeps its own set.
const KEY_TYPES = ["string", "hash", "list", "set", "zset"];
const TYPE_HUES_DARK: Record<string, string> = {
  string: "#6b7280",
  hash: "#b37feb",
  list: "#13c2c2",
  set: "#e260b0",
  zset: "#597ef7",
};
const TYPE_HUES_LIGHT: Record<string, string> = {
  string: "#8c8c8c",
  hash: "#722ed1",
  list: "#08979c",
  set: "#c41d7f",
  zset: "#2f54eb",
};
function typeHue(type: string, isDark: boolean): string {
  return (isDark ? TYPE_HUES_DARK : TYPE_HUES_LIGHT)[type] ?? (isDark ? "#6b7280" : "#8c8c8c");
}

export function KeyBrowser({ target, delimiter, onSelectKey, reloadSignal, readonly = false, isDark = false }: Props) {
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
  const [newKeyType, setNewKeyType] = useState("string");
  const [newKeyValid, setNewKeyValid] = useState(false);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const [ttlKey, setTtlKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  // Re-validate the New Key form on every change so the Modal OK button can be
  // greyed out until it's valid. `validateFields` throws on invalid, so we flip
  // the flag based on whether it resolves. Runs when the form changes or on open.
  const newKey = Form.useWatch((values) => values, form);
  useEffect(() => {
    if (!newOpen) return;
    form
      .validateFields({ validateOnly: true })
      .then(() => setNewKeyValid(true))
      .catch(() => setNewKeyValid(false));
  }, [newOpen, newKey, form]);

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

  const doDelete = useCallback(
    async (keysToDelete: string[]) => {
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
    },
    [connId, db, activeKey, onSelectKey, pattern, load]
  );

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
      const opts: { value?: string; fields?: string[]; values?: string[]; scores?: number[]; ttl?: number } = {};
      if (v.ttl) opts.ttl = Number(v.ttl);
      if (newKeyType === "string") {
        opts.value = v.value ?? "";
      } else if (newKeyType === "hash") {
        const rows = (v.hashRows ?? []) as { field?: string; value?: string }[];
        opts.fields = rows.map((r) => r.field ?? "").filter(Boolean as unknown as (s: string) => boolean);
        opts.values = rows.map((r) => r.value ?? "").filter(Boolean as unknown as (s: string) => boolean);
      } else if (newKeyType === "zset") {
        const rows = (v.zsetRows ?? []) as { score?: number; member?: string }[];
        opts.values = rows.map((r) => r.member ?? "").filter(Boolean as unknown as (s: string) => boolean);
        opts.scores = rows.map((r) => Number(r.score ?? 0));
      } else {
        const rows = (v.listRows ?? []) as { value?: string }[];
        opts.values = rows.map((r) => r.value ?? "").filter(Boolean as unknown as (s: string) => boolean);
      }
      await api.createKey(connId, db, v.key, newKeyType, opts);
      message.success("created");
      setNewOpen(false);
        load(pattern, 0, true);
    } catch (e) {
      message.error(String(e));
    }
  };

  // Left-click: select + open the detail view.
  const selectKey = useCallback(
    (key: string) => {
      setActiveKey(key);
      setActiveFolder(null);
      onSelectKey(key);
    },
    [onSelectKey]
  );

  // Right-click: highlight the row as the menu's subject, but do NOT open the
  // detail view (per desktop best practice — right-click only marks context).
  const highlightKey = useCallback((key: string) => {
    setActiveKey(key);
    setActiveFolder(null);
  }, []);

  const contextMenu = useCallback(
    (key: string) => ({
      items: [
        { key: "copy", label: "Copy key", icon: <CopyOutlined />, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); void navigator.clipboard.writeText(key); message.success("copied"); } },
        { key: "rename", label: "Rename", icon: <EditOutlined />, disabled: readonly, tooltip: readonly ? "Read-only connection" : undefined, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); selectKey(key); setRenameKey(key); } },
        { key: "ttl", label: "Set TTL", icon: <HistoryOutlined />, disabled: readonly, tooltip: readonly ? "Read-only connection" : undefined, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); selectKey(key); setTtlKey(key); } },
        { type: "divider" as const },
        { key: "delete", label: "Delete", icon: <DeleteOutlined />, danger: true, disabled: readonly, tooltip: readonly ? "Read-only connection" : undefined, onClick: (info: { domEvent: { stopPropagation: () => void } }) => { info.domEvent.stopPropagation(); doDelete([key]); } },
      ],
    }),
    [selectKey, doDelete, readonly]
  );

  const folderMenu = (folder: string) => ({
    items: [
      {
        key: "delete",
        label: "Delete all keys",
        icon: <DeleteOutlined />,
        danger: true,
        disabled: readonly,
        tooltip: readonly ? "Read-only connection" : undefined,
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

  // Stable columns so the flat table (memoized) doesn't re-render on view switch.
  const flatColumns = useMemo<TableColumnsType<string>>(
    () => [
      {
        title: "Key",
        align: "left",
        ellipsis: { showTitle: false },
        render: (_, v) => (
          <Dropdown menu={contextMenu(v)} trigger={["contextMenu"]} onOpenChange={(open) => open && highlightKey(v)}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%", userSelect: "none" }}>
              <TruncatedText className="mono" style={{ fontSize: 12, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transform: "translateY(1px)" }}>{v}</TruncatedText>
            </span>
          </Dropdown>
        ),
      },
    ],
    [contextMenu, highlightKey]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 12 }}>
      <div className="key-toolbar" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <Input.Search
          placeholder="Search key (pattern)"
          allowClear
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => e.target.value === "" && setPattern("")}
          onSearch={(v) => {
            setPattern(v);
            load(v, 0, true);
                  }}
        />
        <Segmented
          value={view}
          onChange={(v) => {
            // Only flip the view — keep selection/expanded state so switching
            // doesn't re-render (or flash) the other view via extra setState.
            setView(v as "flat" | "tree");
          }}
          options={[
            { value: "flat", label: "Flat", icon: <UnorderedListOutlined /> },
            { value: "tree", label: "Tree", icon: <ApartmentOutlined /> },
          ]}
        />
        <Tooltip title={readonly ? "New Key (read-only)" : "New Key"}>
          <Button size="small" icon={<PlusOutlined />} disabled={readonly} onClick={() => { setNewKeyType("string"); setNewKeyValid(false); setNewOpen(true); }} />
        </Tooltip>
        <Tooltip title={readonly ? `Delete ${selectedRowKeys.length} selected key(s) (read-only)` : `Delete ${selectedRowKeys.length} selected key(s)`}>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={readonly || selectedRowKeys.length === 0}
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

      <div ref={fillRef} className="key-browser" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, transform: view === "flat" ? "none" : "translateX(-110%)" }}>
          <FlatKeyTable
            columns={flatColumns}
            dataSource={flatKeys}
            loading={loading}
            selectedRowKeys={selectedRowKeys}
            activeKey={activeKey}
            fillH={fillH}
            readonly={readonly}
            onSelectChange={(k) => setSelectedRowKeys(k as string[])}
            onRowClick={selectKey}
          />
        </div>
        <div style={{ position: "absolute", inset: 0, transform: view === "tree" ? "none" : "translateX(-110%)" }}>
          <Tree
            className="key-tree"
            treeData={treeData}
            showLine={false}
            checkable={!readonly}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, userSelect: "none", width: "100%", minWidth: 0, height: 28 }}>
                  {!node.isLeaf &&
                    (expandedKeys.includes(key) ? (
                      <FolderOpenOutlined style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
                    ) : (
                      <FolderOutlined style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
                    ))}
                  <TruncatedText placement="bottomLeft" className="mono" style={{ fontSize: 12, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transform: "translateY(-1px)" }}>{node.title}</TruncatedText>
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
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
        {cursor !== 0 && (
          <Button size="small" loading={loading} onClick={() => load(pattern, cursor, false)}>
            Load more
          </Button>
        )}
      </div>

      <Modal
        className="modal-title-divider"
        open={newOpen}
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span>New Key</span>
            <Dropdown
              menu={{
                items: KEY_TYPES.map((t) => ({
                  key: t,
                  label: <span style={{ color: typeHue(t, isDark) }}>{t}</span>,
                })),
                selectable: true,
                selectedKeys: [newKeyType],
                onClick: ({ key }) => setNewKeyType(key),
              }}
              trigger={["click"]}
            >
              <Button type="text" size="small" style={{ height: "auto", padding: "0 4px", fontSize: 13 }}>
                <span style={{ color: typeHue(newKeyType, isDark) }}>{newKeyType}</span> <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Dropdown>
          </div>
        }
        onOk={doNew}
        onCancel={() => setNewOpen(false)}
        okButtonProps={{ disabled: !newKeyValid }}
        okText="OK"
        cancelText="Cancel"
        width={480}
      >
        <NewKeyForm form={form} type={newKeyType} />
      </Modal>

      <Modal className="modal-title-divider" open={!!renameKey} title="Rename" onOk={doRename} onCancel={() => setRenameKey(null)} okText="OK" cancelText="Cancel">
        <Form form={form} layout="vertical" size="small" preserve={false}>
          <Form.Item name="dst" label="New name" rules={[{ required: true }]}>
            <InputField />
          </Form.Item>
        </Form>
      </Modal>

      <Modal className="modal-title-divider" open={!!ttlKey} title="Set TTL (seconds)" onOk={doTtl} onCancel={() => setTtlKey(null)} okText="OK" cancelText="Cancel">
        <Form form={form} layout="vertical" size="small" preserve={false}>
          <Form.Item name="seconds" label="Seconds (0 or empty = remove expiry)" initialValue={60} rules={[{ required: true }]}>
            <InputField type="number" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// Memoized flat list so switching views (which re-renders KeyBrowser) does NOT
// re-render this virtual table — that re-render was the flash source.
const FlatKeyTable = memo(function FlatKeyTable({
  columns,
  dataSource,
  loading,
  selectedRowKeys,
  activeKey,
  fillH,
  readonly,
  onSelectChange,
  onRowClick,
}: {
  columns: TableColumnsType<string>;
  dataSource: string[];
  loading: boolean;
  selectedRowKeys: string[];
  activeKey: string | null;
  fillH: number;
  readonly?: boolean;
  onSelectChange: (keys: string[]) => void;
  onRowClick: (key: string) => void;
}) {
  return (
    <Table<string>
      size="small"
      rowKey={(v) => v}
      virtual
      showHeader={false}
      columns={columns}
      dataSource={dataSource}
      loading={loading}
      pagination={false}
      rowSelection={readonly ? undefined : { columnWidth: 28, selectedRowKeys, onChange: (k) => onSelectChange(k as string[]) }}
      onRow={(record) => ({
        onClick: (e) => {
          // antd fires row onClick even when the selection checkbox is clicked
          // (#38926). Ignore clicks on the selection column / checkbox so checking
          // a box never opens the key detail — only plain row-body clicks do.
          if ((e.target as HTMLElement).closest(".ant-table-selection-column, .ant-checkbox")) return;
          onRowClick(record);
        },
      })}
      rowClassName={(r) => (r === activeKey ? "ant-table-row-selected" : "")}
      scroll={{ y: fillH }}
    />
  );
});

function NewKeyForm({ form, type }: { form: ReturnType<typeof Form.useForm>[0]; type: string }) {
  return (
    <Form form={form} layout="vertical" size="small" preserve={false}>
      <Row gutter={12}>
        <Col span={16}>
          <Form.Item name="key" label="Key" rules={[{ required: true }]}>
            <InputField />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name="ttl"
            label="TTL"
            initialValue={-1}
            validateTrigger={["onChange", "onBlur"]}
            rules={[
              {
                validator: (_r, v) => {
                  if (v == null || v === "") return Promise.resolve();
                  const n = Number(v);
                  // -1 means "permanent"; 0 or a positive integer is a real TTL.
                  if (n === -1 || (Number.isInteger(n) && n >= 0)) return Promise.resolve();
                  return Promise.reject(new Error("TTL must be -1 or a non-negative integer"));
                },
              },
            ]}
          >
            <InputField style={{ width: "100%" }} />
          </Form.Item>
        </Col>
      </Row>

      {type === "string" && (
        <Form.Item name="value" label="Value">
          <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} className="mono" style={{ fontSize: 12 }} />
        </Form.Item>
      )}

      {type === "hash" && (
        <Form.List name="hashRows">
          {(fields, { add, remove }) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#999" }}>Field / value pairs</span>
              {fields.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Form.Item {...f} name={[f.name, "field"]} noStyle>
                    <InputField placeholder="field" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item {...f} name={[f.name, "value"]} noStyle>
                    <InputField placeholder="value" style={{ flex: 1, minWidth: 0 }} />
                  </Form.Item>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                </div>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
                Add field
              </Button>
            </div>
          )}
        </Form.List>
      )}

      {type === "zset" && (
        <Form.List name="zsetRows">
          {(fields, { add, remove }) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#999" }}>Score / member pairs</span>
              {fields.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Form.Item {...f} name={[f.name, "score"]} noStyle initialValue={0}>
                    <InputNumber controls={false} keyboard={false} placeholder="score" style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item {...f} name={[f.name, "member"]} noStyle>
                    <InputField placeholder="member" style={{ flex: 1, minWidth: 0 }} />
                  </Form.Item>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                </div>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
                Add member
              </Button>
            </div>
          )}
        </Form.List>
      )}

      {(type === "list" || type === "set") && (
        <Form.List name="listRows">
          {(fields, { add, remove }) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#999" }}>{type === "set" ? "Members" : "Items"}</span>
              {fields.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Form.Item {...f} name={[f.name, "value"]} noStyle>
                    <InputField placeholder="value" style={{ flex: 1, minWidth: 0 }} />
                  </Form.Item>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                </div>
              ))}
              <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={() => add()}>
                {type === "set" ? "Add member" : "Add value"}
              </Button>
            </div>
          )}
        </Form.List>
      )}
    </Form>
  );
}
