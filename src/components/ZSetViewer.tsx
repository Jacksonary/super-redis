import { useCallback, useEffect, useState } from "react";
import { Table, Input, InputNumber, Button, Space, Popconfirm, message } from "antd";
import type { SelectedTarget, ZSetItem } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

const PAGE = 300;

export function ZSetViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [items, setItems] = useState<ZSetItem[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState<number>(0);

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getZsetItems(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
        setCursor(res.cursor);
      } catch (e) {
        message.error(String(e));
      } finally {
        setLoading(false);
      }
    },
    [connId, db, currentKey]
  );

  useEffect(() => {
    setItems([]);
    load(0, true);
  }, [connId, db, currentKey, load]);

  const add = async () => {
    if (!newMember) return;
    await api.addZsetItem(connId, db, currentKey, newMember, newScore);
    message.success("added");
    setNewMember("");
    load(0, true);
  };

  const remove = async (member: string) => {
    await api.deleteZsetItem(connId, db, currentKey, [member]);
    message.success("deleted");
    load(0, true);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <Space>
        <Input
          value={newMember}
          placeholder="member"
          style={{ width: 200 }}
          onChange={(e) => setNewMember(e.target.value)}
          onPressEnter={add}
        />
        <InputNumber
          value={newScore}
          onChange={(v) => setNewScore(v ?? 0)}
          placeholder="score"
          style={{ width: 120 }}
        />
        <Button size="small" type="primary" onClick={add}>Add</Button>
        {cursor !== 0 && (
          <Button size="small" onClick={() => load(cursor, false)} disabled={loading}>Load more</Button>
        )}
      </Space>
      <Table<ZSetItem>
        size="small"
        rowKey="member"
        columns={[
          { title: "Score", dataIndex: "score", width: 120, render: (s: number) => <span style={{ fontSize: 12 }}>{s}</span> },
          { title: "Member", dataIndex: "member", render: (m: string) => <span style={{ fontSize: 12 }}>{m}</span> },
          {
            title: "Actions",
            width: 90,
            render: (_, r) => (
              <Popconfirm title="Delete member?" onConfirm={() => remove(r.member)}>
                <Button size="small" type="link" danger>Delete</Button>
              </Popconfirm>
            ),
          },
        ]}
        dataSource={items}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 360px)" }}
      />
    </div>
  );
}
