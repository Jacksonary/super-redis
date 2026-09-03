import { useEffect, useRef, useState } from "react";
import { Button, Select, Typography } from "antd";
import { ConsoleSqlOutlined, DashboardOutlined, HomeOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { KeyBrowser } from "./KeyBrowser";
import { ValuePanel } from "./ValuePanel";
import { ConnInfoPanel } from "./ConnInfoPanel";
import { TerminalTab } from "./TerminalTab";
import { MonitorTab } from "./MonitorTab";

const { Text } = Typography;

export function Workspace({ target, isDark, onDbChange }: { target: SelectedTarget; isDark: boolean; onDbChange: (db: number) => void }) {
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [dbCount, setDbCount] = useState(0);

  useEffect(() => {
    api.getDbCount(target.connectionId).then(setDbCount).catch(() => {});
  }, [target.connectionId]);
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
      <div style={{ height: 32, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>DB:</Text>
        <Select
          value={target.db}
          onChange={onDbChange}
          size="small"
          style={{ width: 110 }}
          options={Array.from({ length: Math.max(dbCount, 16) }, (_, i) => ({ value: i, label: `DB ${i}` }))}
        />
        <div style={{ flex: 1 }} />
        {selectedKey && (
          <Button
            size="small"
            icon={<HomeOutlined />}
            onClick={() => {
              setSelectedKey("");
            }}
          >
            Overview
          </Button>
        )}
      </div>
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
            <ConnInfoPanel target={target} />
          )}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${borderColor}`, height: terminalOpen || monitorOpen ? "40vh" : 40, transition: "height .2s" }}>
        <div
          style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}
        >
          <Button
            size="small"
            type={terminalOpen ? "primary" : "default"}
            icon={<ConsoleSqlOutlined />}
            onClick={() => {
              setTerminalOpen((v) => !v);
              setMonitorOpen(false);
            }}
          >
            Terminal
          </Button>
          <Button
            size="small"
            type={monitorOpen ? "primary" : "default"}
            icon={<DashboardOutlined />}
            onClick={() => {
              setMonitorOpen((v) => !v);
              setTerminalOpen(false);
            }}
          >
            Monitor
          </Button>
        </div>
        {terminalOpen && <TerminalTab target={target} />}
        {monitorOpen && <MonitorTab target={target} />}
      </div>
    </div>
  );
}
