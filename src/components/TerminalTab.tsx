import { useEffect, useRef, useState } from "react";
import { Typography, theme } from "antd";
import { ClearOutlined } from "@ant-design/icons";
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

const PROMPT = "#1677ff";

export function TerminalTab({ target }: Props) {
  const { connectionId: connId, db } = target;
  const { token } = theme.useToken();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const histIndexRef = useRef(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => inputRef.current?.focus();

  const execute = async (cmd: string) => {
    setRunning(true);
    setInput("");
    histIndexRef.current = -1;
    try {
      const res = await api.runCommand(connId, db, cmd);
      setLog((prev) => [...prev, { cmd, result: res.result }]);
    } catch (e) {
      setLog((prev) => [...prev, { cmd, result: String(e), error: true }]);
    } finally {
      setRunning(false);
      requestAnimationFrame(() => focusInput());
    }
  };

  // Scroll to the latest output whenever the log grows. This runs AFTER React has
  // committed the new log to the DOM, so scrollHeight reflects the full content —
  // doing it in a requestAnimationFrame tied to the async state update was firing
  // before the DOM changed and left the view scrolled short of the newest line.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [log]);

  const submit = (raw: string) => {
    const cmd = raw.trim();
    if (!cmd || running) return;
    setHistory((prev) => [...prev, cmd]);
    execute(cmd);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(input);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const len = history.length;
      if (!len) return;
      const idx = histIndexRef.current === -1 ? len - 1 : Math.max(0, histIndexRef.current - 1);
      histIndexRef.current = idx;
      setInput(history[idx]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIndexRef.current === -1) return;
      const idx = histIndexRef.current + 1;
      if (idx >= history.length) {
        histIndexRef.current = -1;
        setInput("");
      } else {
        histIndexRef.current = idx;
        setInput(history[idx]);
      }
    }
  };

  return (
    <div
      className="mono"
      onClick={focusInput}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        margin: "0 12px 8px",
        background: token.colorFillTertiary,
        borderRadius: 6,
        cursor: "text",
        overflow: "hidden",
      }}
    >
      {/* Output stream — takes most of the height and scrolls */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px 10px", fontSize: 12, lineHeight: 1.5 }}>
        {log.length === 0 && (
          <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
            Type a Redis command and press Enter
          </Text>
        )}
        {log.map((l, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <div>
              <span style={{ color: PROMPT, fontWeight: 700 }}>{"> "}</span>
              <span style={{ fontWeight: 600 }}>{l.cmd}</span>
            </div>
            <div style={{ whiteSpace: "pre-wrap", color: l.error ? "#ff4d4f" : "#2f9e44", paddingLeft: 16 }}>{l.result}</div>
          </div>
        ))}
      </div>

      {/* Fixed single-line input at the very bottom, part of the same block */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", flexShrink: 0, borderTop: `1px solid ${token.colorSplit}` }}>
        <span style={{ color: PROMPT, fontWeight: 700, flexShrink: 0 }}>{"> "}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          placeholder="Press Enter to exec commands, Up/Down to switch history"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            color: "inherit",
            fontSize: 12,
            fontFamily: "inherit",
            padding: 0,
          }}
        />
        <ClearOutlined
          onClick={(e) => {
            e.stopPropagation();
            setLog([]);
          }}
          style={{ color: token.colorTextTertiary, cursor: log.length ? "pointer" : "default", opacity: log.length ? 1 : 0.3, flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
