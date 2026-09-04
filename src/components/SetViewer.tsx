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

const PAGE = 300;

export function SetViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const [members, setMembers] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (c: number, reset: boolean) => {
      setLoading(true);
      try {
        const res = await api.getSetItems(connId, db, currentKey, c ? String(c) : undefined, PAGE);
        setMembers((prev) => (reset ? res.members : [...prev, ...res.members]));
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
    setMembers([]);
    load(0, true);
  }, [connId, db, currentKey, load, refreshSignal]);

  const add = async () => {
    if (!newMember) return;
    await api.addSetItem(connId, db, currentKey, [newMember]);
    setNewMember("");
    message.success("added");
    load(0, true);
  };

  const remove = (member: string) => {
    modal.confirm({
      title: "Delete member",
      content: `Delete "${member}" from set?`,
      okText: "Delete",
      cancelText: "Cancel",
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.deleteSetItem(connId, db, currentKey, [member]);
        message.success("deleted");
        load(0, true);
      },
    });
  };

  const rename = (oldMember: string) => {
    let next: string | null = null;
    modal.confirm({
      title: "Rename member",
      content: (
        <Input
          defaultValue={oldMember}
          onChange={(e) => (next = e.target.value)}
          autoFocus
        />
      ),
      okText: "Rename",
      cancelText: "Cancel",
      onOk: async () => {
        if (next && next !== oldMember) {
          await api.renameSetMember(connId, db, currentKey, oldMember, next);
          message.success("renamed");
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
      const res = await api.searchSetMember(connId, db, currentKey, q);
      setMembers(res.members);
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
            style={{ width: 220 }}
            onChange={(e) => setNewMember(e.target.value)}
            onPressEnter={add}
          />
          <Button size="small" type="primary" onClick={add}>Add member</Button>
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
      <Table<string>
        size="small"
        rowKey={(v, i) => `${i}-${v}`}
        columns={[
          { title: <span>Member (Total: {total})</span>, render: (_, v) => <span style={{ fontSize: 12 }}>{v}</span> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, v) => (
              <Space size={4}>
                <Tooltip title="Rename">
                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => rename(v)} />
                </Tooltip>
                <Tooltip title="Delete">
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(v)} />
                </Tooltip>
              </Space>
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
