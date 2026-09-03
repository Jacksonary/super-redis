import { useRef, useState } from "react";
import { Input, Button, Space, Typography } from "antd";
import type { SelectedTarget } from "../types";
import { api } from "../api";

const { Text } = Typography;

interface Props {
  target: SelectedTarget;
}

interface LogEntry {
  cmd: string;
  result: string;
  error?: boolean;
}

export function TerminalTab({ target }: Props) {
  const { connectionId: connId, db } = target;
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = async () => {
    const cmd = input.trim();
    if (!cmd) return;
    setRunning(true);
    setInput("");
    try {
      const res = await api.runCommand(connId, db, cmd);
      setLog((prev) => [...prev, { cmd, result: res.result }]);
    } catch (e) {
      setLog((prev) => [...prev, { cmd, result: String(e), error: true }]);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight));
    }
  };

  return (
    <div style={{ height: "calc(38vh - 40px)", display: "flex", flexDirection: "column", padding: "0 12px 8px" }}>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "SF Mono, Menlo, monospace",
          fontSize: 12,
          padding: 8,
          background: "rgba(0,0,0,0.06)",
          borderRadius: 6,
        }}
      >
        {log.length === 0 && <Text type="secondary">Enter a command, e.g. SET k v / GET k</Text>}
        {log.map((l, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 600 }}>
              <span style={{ color: "#1677ff" }}>&gt; </span>
              {l.cmd}
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: l.error ? "#ff4d4f" : "#2f9e44" }}>{l.result}</div>
          </div>
        ))}
      </div>
      <Space style={{ marginTop: 6 }}>
        <Input.TextArea
          value={input}
          autoSize={{ minRows: 1, maxRows: 3 }}
          placeholder="Enter a Redis command"
          style={{ fontFamily: "SF Mono, Menlo, monospace", fontSize: 12.5, width: 460 }}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              run();
            }
          }}
          disabled={running}
        />
        <Button type="primary" onClick={run} loading={running} disabled={!input.trim()}>Run</Button>
        <Button size="small" onClick={() => setLog([])}>Clear</Button>
      </Space>
    </div>
  );
}
