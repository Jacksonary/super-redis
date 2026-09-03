import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, message } from "antd";
import type { SelectedTarget } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

const PAGE = 200;

export function ListViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [items, setItems] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pushVal, setPushVal] = useState("");

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
  }, [connId, db, currentKey, load]);

  const push = async (left: boolean) => {
    await api.pushListItem(connId, db, currentKey, pushVal, left);
    setPushVal("");
    load(page);
  };

  const remove = async (value: string, index?: number) => {
    await api.deleteListItem(connId, db, currentKey, value, index);
    message.success("deleted");
    load(page);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
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
      <Table<string>
        size="small"
        rowKey={(v, i) => `${i}`}
        columns={[
          { title: "Index", width: 70, render: (_, __, i) => <span style={{ fontSize: 12 }}>{page * PAGE + i}</span> },
          { title: "Value", render: (_, v) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "Actions",
            width: 90,
            render: (_, v, i) => (
              <Button size="small" type="link" danger onClick={() => remove(v, page * PAGE + i)}>Delete</Button>
            ),
          },
        ]}
        dataSource={items}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 360px)" }}
      />
      <Space style={{ justifyContent: "flex-end" }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Total {total} items, page {page + 1}</span>
        <Button size="small" disabled={page === 0} onClick={() => { setPage((p) => p - 1); load(page - 1); }}>Prev</Button>
        <Button size="small" disabled={(page + 1) * PAGE >= total} onClick={() => { setPage((p) => p + 1); load(page + 1); }}>Next</Button>
      </Space>
    </div>
  );
}
