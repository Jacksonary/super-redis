import { useEffect, useState } from "react";
import { Button, Input, Tooltip, Typography, Select } from "antd";
import { message } from "../antd-app";
import { CopyOutlined } from "@ant-design/icons";

const { TextArea } = Input;
const { Text } = Typography;
import type { SelectedTarget } from "../types";
import { api } from "../api";

const FORMATS = ["text", "json", "hex", "base64", "gzip", "deflate", "brotli", "msgpack"];

interface Props {
  target: SelectedTarget;
  currentKey: string;
  refreshSignal?: number;
}

export function StringViewer({ target, currentKey, refreshSignal }: Props) {
  const { connectionId: connId, db } = target;
  const [value, setValue] = useState("");
  const [binary, setBinary] = useState(false);
  const [format, setFormat] = useState("text");
  const [decoded, setDecoded] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getValue(connId, db, currentKey)
      .then((r) => {
        setValue(r.value);
        setBinary(r.is_binary);
        setFormat("text");
      })
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, db, currentKey, refreshSignal]);

  // Fetch the decoded/prettified text when a non-text format is selected.
  useEffect(() => {
    if (format === "text") {
      setDecoded(value);
      return;
    }
    api
      .decodeValue(connId, db, currentKey, format)
      .then((r) => setDecoded(r.text))
      .catch((e) => setDecoded(`(error: ${e})`));
  }, [format, connId, db, currentKey, value]);

  const shown = format === "text" ? value : decoded;
  const editable = format === "text";

  const save = async () => {
    await api.setValue(connId, db, currentKey, value);
    message.success("saved");
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <TextArea
          className="mono"
          style={{ height: "100%", resize: "none", fontSize: 12.5 }}
          value={shown}
          onChange={(e) => editable && setValue(e.target.value)}
          disabled={loading || !editable}
          readOnly={!editable}
        />
        <div style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <Select
            size="small"
            value={format}
            onChange={setFormat}
            style={{ width: 92 }}
            options={FORMATS.map((f) => ({ value: f, label: f }))}
          />
          <Tooltip title="Copy {format}">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={async () => {
                await navigator.clipboard.writeText(shown);
                message.success("copied");
              }}
            />
          </Tooltip>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="small" onClick={save} disabled={loading || !editable} type="primary">Save</Button>
      </div>
      {editable && binary && (
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>Binary value — Text/hex/base64 formats are read-only.</Text>
        </div>
      )}
    </div>
  );
}
