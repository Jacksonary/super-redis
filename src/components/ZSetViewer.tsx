import { useCallback, useEffect, useState } from "react";
import { Table, Input, InputNumber, Button, Space, Tooltip } from "antd";
import { SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget, ZSetItem } from "../types";
import { api } from "../api";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
}

const PAGE = 300;

export function ZSetViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const [items, setItems] = useState<ZSetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState<number>(0);
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getZsetItems(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setItems((prev) => (reset ? res.items : [...prev, ...res.items]));
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
    setItems([]);
    load(0, true);
  }, [connId, db, currentKey, load, refreshSignal]);

  const add = async () => {
    if (!newMember) return;
    await api.addZsetItem(connId, db, currentKey, newMember, newScore);
    message.success("added");
    setNewMember("");
    load(0, true);
  };

  const remove = (member: string) => {
    modal.confirm({
      title: "Delete member",
      content: `Delete "${member}"?`,
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteZsetItem(connId, db, currentKey, [member]);
        message.success("deleted");
        load(0, true);
      },
    });
  };

  const editScore = (r: ZSetItem) => {
    let member = r.member;
    let score: number | null = null;
    modal.confirm({
      title: `Edit: ${r.member}`,
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input
            defaultValue={r.member}
            onChange={(e) => (member = e.target.value)}
            autoFocus
            placeholder="member"
          />
          <InputNumber
            defaultValue={r.score}
            onChange={(v) => (score = v)}
            style={{ width: 160 }}
            placeholder="score"
          />
        </Space>
      ),
      okText: "Save",
      cancelText: "Cancel",
      onOk: async () => {
        if (score !== null) {
          await api.renameZsetMember(connId, db, currentKey, r.member, member, score);
          message.success("updated");
          load(0, true);
        }
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
      const res = await api.searchZsetMember(connId, db, currentKey, q);
      setItems(res.items);
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
            style={{ width: 70 }}
          />
          <Button size="small" type="primary" onClick={add}>Add</Button>
          {cursor !== 0 && (
            <Button size="small" onClick={() => load(cursor, false)} disabled={loading}>Load more</Button>
          )}
        </Space>
        <div style={{ flex: 1 }} />
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search member"
          style={{ width: 180 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => doSearch(search)}
        />
      </div>
      <Table<ZSetItem>
        size="small"
        rowKey="member"
        columns={[
          { title: "Score", dataIndex: "score", width: 120, render: (s: number) => <span style={{ fontSize: 12 }}>{s}</span> },
          { title: <span>Member (Total: {total})</span>, dataIndex: "member", render: (m: string) => <span style={{ fontSize: 12 }}>{m}</span> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, r) => (
              <Space size={4}>
                <Tooltip title="Edit score">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => editScore(r)} />
                </Tooltip>
                <Tooltip title="Delete">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(r.member)} />
                </Tooltip>
              </Space>
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
