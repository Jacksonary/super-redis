import { useRef, useState } from "react";
import { Button, Typography } from "antd";
import { ConsoleSqlOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { KeyBrowser } from "./KeyBrowser";
import { ValuePanel } from "./ValuePanel";
import { TerminalTab } from "./TerminalTab";

const { Text } = Typography;

export function Workspace({ target, isDark }: { target: SelectedTarget; isDark: boolean }) {
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setSplitRatio(Math.min(0.6, Math.max(0.2, ratio)));
  };
  const stopDrag = () => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: `${splitRatio * 100}%`, minWidth: 260, borderRight: `1px solid ${borderColor}` }}>
          <KeyBrowser target={target} onSelectKey={setSelectedKey} />
        </div>
        <div
          onMouseDown={startDrag}
          style={{ width: 6, cursor: "col-resize", background: "transparent", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedKey ? (
            <ValuePanel target={target} currentKey={selectedKey} key={selectedKey} />
          ) : (
            <div className="empty-state-wrap" style={{ height: "100%", justifyContent: "center", padding: 24 }}>
              <Text type="secondary">{isDark ? "Please select a key" : "Please select a key"}</Text>
            </div>
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${borderColor}`, height: terminalOpen ? "38vh" : 40, transition: "height .2s" }}>
        <div
          style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}
        >
          <Button
            size="small"
            type={terminalOpen ? "primary" : "default"}
            icon={<ConsoleSqlOutlined />}
            onClick={() => setTerminalOpen((v) => !v)}
          >
            {isDark ? "Terminal" : "Terminal"}
          </Button>
        </div>
        {terminalOpen && <TerminalTab target={target} />}
      </div>
    </div>
  );
}
