import { useCallback, useEffect, useState } from "react";
import { Table, Input, InputNumber, Button, Space, Tooltip, Modal } from "antd";
import { SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget, ZSetItem } from "../types";
import { api } from "../api";
import { TruncatedText } from "./TruncatedText";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
  readonly?: boolean;
}

const PAGE = 300;

export function ZSetViewer({ target, currentKey, refreshSignal, readonly = false }: Props) {
  const { connectionId: connId, db } = target;
  const [items, setItems] = useState<ZSetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");
  const [newScore, setNewScore] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [editMember, setEditMember] = useState("");
  const [editScoreVal, setEditScoreVal] = useState<number | null>(null);

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
    setEditTarget(r.member);
    setEditMember(r.member);
    setEditScoreVal(r.score);
  };

  const saveEdit = async () => {
    if (editTarget === null || editScoreVal === null) return;
    await api.renameZsetMember(connId, db, currentKey, editTarget, editMember, editScoreVal);
    message.success("updated");
    setEditTarget(null);
    load(0, true);
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
            disabled={readonly}
            style={{ width: 200 }}
            onChange={(e) => setNewMember(e.target.value)}
            onPressEnter={add}
          />
          <InputNumber
            value={newScore}
            disabled={readonly}
            onChange={(v) => setNewScore(v ?? 0)}
            placeholder="score"
            style={{ width: 70 }}
          />
          <Button size="small" type="primary" disabled={readonly} onClick={add}>Add</Button>
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
          { title: "Score", dataIndex: "score", align: "right", minWidth: 90, render: (s: number) => <span className="mono" style={{ fontSize: 12 }}>{s}</span> },
          { title: <span>Member (Total: {total})</span>, dataIndex: "member", ellipsis: { showTitle: false }, render: (m: string) => <TruncatedText className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{m}</TruncatedText> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, r) => (
              <Space size={4}>
                <Tooltip title={readonly ? "Edit score (read-only)" : "Edit score"}>
                  <Button size="small" type="text" icon={<EditOutlined />} disabled={readonly} onClick={() => editScore(r)} />
                </Tooltip>
                <Tooltip title={readonly ? "Delete (read-only)" : "Delete"}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={readonly} onClick={() => remove(r.member)} />
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
      <Modal
        className="modal-title-divider"
        open={editTarget !== null}
        title={`Edit: ${editTarget}`}
        okText="Save"
        cancelText="Cancel"
        onOk={saveEdit}
        onCancel={() => setEditTarget(null)}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input value={editMember} onChange={(e) => setEditMember(e.target.value)} placeholder="member" />
          <InputNumber
            value={editScoreVal}
            onChange={(v) => setEditScoreVal(v)}
            style={{ width: 160 }}
            placeholder="score"
          />
        </Space>
      </Modal>
    </div>
  );
}
