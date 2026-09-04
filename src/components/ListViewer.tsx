import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Tooltip } from "antd";
import { SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
}

const PAGE = 200;

export function ListViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const [items, setItems] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pushVal, setPushVal] = useState("");
  const [search, setSearch] = useState("");
  const [searchIdx, setSearchIdx] = useState<number | null>(null);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const res = await api.getListItems(connId, db, currentKey, p * PAGE, (p + 1) * PAGE - 1);
        setItems(res.items);
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
    setPage(0);
    load(0);
  }, [connId, db, currentKey, load, refreshSignal]);

  const push = async (left: boolean) => {
    await api.pushListItem(connId, db, currentKey, pushVal, left);
    setPushVal("");
    load(page);
  };

  const remove = (value: string, index?: number) => {
    modal.confirm({
      title: "Delete item",
      content: `Delete index ${index}?`,
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteListItem(connId, db, currentKey, value, index);
        message.success("deleted");
        load(page);
      },
    });
  };

  const editValue = (value: string, index: number) => {
    let next: string | null = null;
    modal.confirm({
      title: `Edit index ${index}`,
      content: (
        <Input defaultValue={value} onChange={(e) => (next = e.target.value)} autoFocus />
      ),
      okText: "Save",
      cancelText: "Cancel",
      onOk: async () => {
        if (next !== null) {
          await api.setListValue(connId, db, currentKey, index, next);
          message.success("saved");
          load(page);
        }
      },
    });
  };

  const doSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) {
      setSearchIdx(null);
      return;
    }
    try {
      const res = await api.searchListValue(connId, db, currentKey, q);
      if (res.found) {
        setSearchIdx(res.index);
      } else {
        message.info("Value not found in list");
        setSearchIdx(null);
      }
    } catch (e) {
      message.error(String(e));
    }
  };

  return (
    <div className="value-viewer" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Space>
          <Input
            value={pushVal}
            placeholder="value"
            style={{ width: 220 }}
            onChange={(e) => setPushVal(e.target.value)}
            onPressEnter={() => push(false)}
          />
          <Button size="small" onClick={() => push(true)}>LPUSH</Button>
          <Button size="small" type="primary" onClick={() => push(false)}>RPUSH</Button>
        </Space>
        <div style={{ flex: 1 }} />
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Find value"
          style={{ width: 180 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => doSearch(search)}
        />
      </div>
      <Table<string>
        size="small"
        rowKey={(v, i) => `${i}`}
        columns={[
          { title: <span>Index (Total: {total})</span>, render: (_, __, i) => <span style={{ fontSize: 12 }}>{page * PAGE + i}</span> },
          { title: "Value", render: (_, v) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, v, i) => {
              const idx = page * PAGE + i;
              return (
                <Space size={4}>
                  <Tooltip title="Edit value">
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => editValue(v, idx)} />
                  </Tooltip>
                  <Tooltip title="Delete">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(v, idx)} />
                  </Tooltip>
                </Space>
              );
            },
          },
        ]}
        dataSource={items}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 360px)" }}
        onRow={(_, i) => ({
          style: searchIdx !== null && page * PAGE + (i ?? 0) === searchIdx ? { background: "rgba(22,119,255,0.18)" } : {},
        })}
      />
      <Space style={{ justifyContent: "flex-end" }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Total {total} items, page {page + 1}</span>
        <Button size="small" disabled={page === 0} onClick={() => { setPage((p) => p - 1); load(page - 1); }}>Prev</Button>
        <Button size="small" disabled={(page + 1) * PAGE >= total} onClick={() => { setPage((p) => p + 1); load(page + 1); }}>Next</Button>
      </Space>
    </div>
  );
}
