import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, message } from "antd";
import type { SelectedTarget } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

const PAGE = 300;

export function SetViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [members, setMembers] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getSetItems(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setMembers((prev) => (reset ? res.members : [...prev, ...res.members]));
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
    setMembers([]);
    load(0, true);
  }, [connId, db, currentKey, load]);

  const add = async () => {
    if (!newMember) return;
    await api.addSetItem(connId, db, currentKey, [newMember]);
    setNewMember("");
    message.success("added");
    load(0, true);
  };

  const remove = async (member: string) => {
    await api.deleteSetItem(connId, db, currentKey, [member]);
    message.success("deleted");
    load(0, true);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <Space>
        <Input
          value={newMember}
          placeholder="member"
          style={{ width: 220 }}
          onChange={(e) => setNewMember(e.target.value)}
          onPressEnter={add}
        />
        <Button size="small" type="primary" onClick={add}>新增成员</Button>
        {cursor !== 0 && (
          <Button size="small" onClick={() => load(cursor, false)} disabled={loading}>加载更多</Button>
        )}
      </Space>
      <Table<string>
        size="small"
        rowKey={(v, i) => `${i}-${v}`}
        columns={[
          { title: "Member", render: (_, v) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "操作",
            width: 90,
            render: (_, v) => (
              <Button size="small" type="link" danger onClick={() => remove(v)}>删除</Button>
            ),
          },
        ]}
        dataSource={members}
        loading={loading}
        pagination={false}
        scroll={{ y: "calc(100vh - 360px)" }}
      />
    </div>
  );
}
