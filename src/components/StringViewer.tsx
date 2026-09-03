import { useEffect, useState } from "react";
import { Button, Input, Typography, message } from "antd";

const { Text } = Typography;
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { isValidJson, prettyJson } from "../utils";

const { TextArea } = Input;

interface Props {
  target: SelectedTarget;
  currentKey: string;
}

export function StringViewer({ target, currentKey }: Props) {
  const { connectionId: connId, db } = target;
  const [value, setValue] = useState("");
  const [binary, setBinary] = useState(false);
  const [json, setJson] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getValue(connId, db, currentKey)
      .then((r) => {
        setValue(r.value);
        setBinary(r.is_binary);
        setJson(!r.is_binary && isValidJson(r.value));
      })
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, db, currentKey]);

  const save = async () => {
    await api.setValue(connId, db, currentKey, value);
    message.success("saved");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Button size="small" onClick={save} disabled={loading} type="primary">Save</Button>
        {binary ? (
          <Text type="secondary" style={{ fontSize: 12 }}>Binary value</Text>
        ) : (
          json && value && (
            <Button size="small" onClick={() => setValue(prettyJson(value))}>Format</Button>
          )
        )}
      </div>
      <TextArea
        style={{ flex: 1, resize: "none", fontFamily: "SF Mono, Menlo, monospace", fontSize: 12.5 }}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading}
      />
    </div>
  );
}
