import { useCallback, useEffect, useState } from "react";
import { Table, Input, Button, Space, Tooltip, Modal } from "antd";
import { SearchOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { message, modal } from "../antd-app";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { TruncatedText } from "./TruncatedText";

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
  readonly?: boolean;
}

const PAGE = 300;

export function SetViewer({ target, currentKey, refreshSignal, readonly = false }: Props) {
  const { connectionId: connId, db } = target;
  const [members, setMembers] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [newMember, setNewMember] = useState("");
  const [search, setSearch] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

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

  const rename = (member: string) => {
    setRenameTarget(member);
    setRenameVal(member);
  };

  const saveRename = async () => {
    if (renameTarget === null || !renameVal || renameVal === renameTarget) return;
    await api.renameSetMember(connId, db, currentKey, renameTarget, renameVal);
    message.success("renamed");
    setRenameTarget(null);
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
            disabled={readonly}
            style={{ width: 220 }}
            onChange={(e) => setNewMember(e.target.value)}
            onPressEnter={add}
          />
          <Button size="small" type="primary" disabled={readonly} onClick={add}>Add member</Button>
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
        rowKey={(v) => v}
        columns={[
          { title: <span>Member (Total: {total})</span>, ellipsis: { showTitle: false }, render: (_, v) => <TruncatedText className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{v}</TruncatedText> },
          {
            title: "Actions",
            width: 100,
            align: "center",
            render: (_, v) => (
              <Space size={4}>
                <Tooltip title={readonly ? "Rename (read-only)" : "Rename"}>
                  <Button size="small" type="text" icon={<EditOutlined />} disabled={readonly} onClick={() => rename(v)} />
                </Tooltip>
                <Tooltip title={readonly ? "Delete (read-only)" : "Delete"}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={readonly} onClick={() => remove(v)} />
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
      <Modal
        className="modal-title-divider"
        open={renameTarget !== null}
        title="Rename member"
        okText="Rename"
        cancelText="Cancel"
        onOk={saveRename}
        onCancel={() => setRenameTarget(null)}
      >
        <Input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus onPressEnter={saveRename} />
      </Modal>
    </div>
  );
}
