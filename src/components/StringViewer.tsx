import { useEffect, useState } from "react";
import { Button, Input, Space, Typography, Segmented, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";

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
  const [hex, setHex] = useState("");
  const [binary, setBinary] = useState(false);
  const [json, setJson] = useState(false);
  const [view, setView] = useState<"text" | "hex">("text");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getValue(connId, db, currentKey)
      .then((r) => {
        setValue(r.value);
        setBinary(r.is_binary);
        setHex(r.hex ?? "");
        setView(r.is_binary ? "hex" : "text");
        // Only attempt the (synchronous) JSON.parse on reasonably short strings so
        // a multi-MB value doesn't block the main thread.
        setJson(!r.is_binary && r.value.length < 200_000 && isValidJson(r.value));
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
        <Space size={8}>
          <Button size="small" onClick={save} disabled={loading || binary} type="primary">Save</Button>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={async () => {
              await navigator.clipboard.writeText(view === "hex" && hex ? hex : value);
              message.success("copied");
            }}
          >
            Copy
          </Button>
        </Space>
        {binary ? (
          <Segmented
            size="small"
            value={view}
            onChange={(v) => setView(v as "text" | "hex")}
            options={["hex", "text"]}
          />
        ) : (
          json && value && (
            <Button size="small" onClick={() => setValue(prettyJson(value))}>Format</Button>
          )
        )}
      </div>
      <TextArea
        style={{ flex: 1, resize: "none", fontFamily: "SF Mono, Menlo, monospace", fontSize: 12.5 }}
        value={view === "hex" && hex ? hex : value}
        onChange={(e) => (view === "hex" && binary ? setHex(e.target.value) : setValue(e.target.value))}
        disabled={loading}
      />
    </div>
  );
}
