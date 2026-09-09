import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Typography, Breadcrumb, Tooltip, Space, Input, InputNumber } from "antd";
import { ConsoleSqlOutlined, DashboardOutlined, HomeOutlined, DownOutlined, CloseOutlined, SearchOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { KeyBrowser } from "./KeyBrowser";
import { ValuePanel } from "./ValuePanel";
import { ConnInfoPanel } from "./ConnInfoPanel";
import { TerminalTab } from "./TerminalTab";
import { MonitorTab, type MonitorSub } from "./MonitorTab";
import { TruncatedText } from "./TruncatedText";

const { Text } = Typography;

export function Workspace({ target, connectionName, readonly, delimiter, isDark, onDbChange }: { target: SelectedTarget; connectionName: string; readonly: boolean; delimiter: string; isDark: boolean; onDbChange: (db: number) => void }) {
  const borderColor = "var(--border)";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [dbCount, setDbCount] = useState(0);
  const [panelH, setPanelH] = useState(260); // bottom terminal/monitor panel height (px)
  const [panelOpen, setPanelOpen] = useState(false);
  const [monitorSub, setMonitorSub] = useState<MonitorSub>("slowlog");
  // Memory analyze is triggered from the bottom bar (Analyze icon) + the count is
  // shown there too, so it's lifted here; the pattern/sample inputs stay in the
  // Memory panel.
  const [memoryAnalyzeSignal, setMemoryAnalyzeSignal] = useState(0);
  const [memoryScanned, setMemoryScanned] = useState(0);
  const [memoryPattern, setMemoryPattern] = useState("");
  const [memorySample, setMemorySample] = useState(2000);
  const panelDragging = useRef(false);

  useEffect(() => {
    api.getDbCount(target.connectionId).then(setDbCount).catch(() => {});
  }, [target.connectionId]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.classList.add("dragging");
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setSplitRatio(Math.min(0.6, Math.max(0.2, ratio)));
  };
  const stopDrag = () => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.classList.remove("dragging");
  };

  // Drag the bottom terminal/monitor panel to resize its height.
  const startPanelDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    panelDragging.current = true;
    document.body.style.cursor = "row-resize";
    document.body.classList.add("dragging");
  };
  const onPanelMouseMove = (e: MouseEvent) => {
    if (!panelDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const h = rect.bottom - e.clientY; // distance from mouse to container bottom
    setPanelH(Math.min(rect.height * 0.6, Math.max(140, h)));
  };
  const stopPanelDrag = () => {
    panelDragging.current = false;
    document.body.style.cursor = "";
    document.body.classList.remove("dragging");
  };

  // Open the bottom panel on a specific Monitor sub-page (hover → click).
  const openMonitor = (sub: MonitorSub) => {
    setMonitorSub(sub);
    setPanelOpen(true);
    setMonitorOpen(true);
    setTerminalOpen(false);
  };

  // Global mouse handlers so a drag that leaves the container (or window) still
  // cleans up the `dragging` class + cursor on mouseup, instead of sticking.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      onMouseMove(e);
      onPanelMouseMove(e);
    };
    const up = () => {
      stopDrag();
      stopPanelDrag();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", height: "100vh" }}
    >
      <div style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderBottom: `1px solid ${borderColor}`, flexShrink: 0 }}>
        <Breadcrumb
          style={{ flex: 1, minWidth: 0 }}
          items={[
            {
              title: (
                <TruncatedText style={{ fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{connectionName || "Connection"}</TruncatedText>
              ),
            },
            {
              title: (
                <Dropdown
                  menu={{
                    items: Array.from({ length: Math.max(dbCount, 16) }, (_, i) => ({
                      key: String(i),
                      label: `DB${i}`,
                      onClick: () => onDbChange(i),
                    })),
                    selectable: true,
                    selectedKeys: [String(target.db)],
                  }}
                  trigger={["click"]}
                >
                  <Text style={{ fontSize: 12, cursor: "pointer" }} onClick={(e) => e.preventDefault()}>
                    DB{target.db} <DownOutlined style={{ fontSize: 9, opacity: 0.55 }} />
                  </Text>
                </Dropdown>
              ),
            },
            ...(selectedKey
              ? [{ title: (
                  <TruncatedText className="mono" style={{ fontSize: 12, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedKey}</TruncatedText>
                ) }]
              : []),
          ]}
        />
        <Button
          size="small"
          icon={<HomeOutlined />}
          onClick={() => {
            setSelectedKey("");
          }}
        >
          Overview
        </Button>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div style={{ width: `${splitRatio * 100}%`, minWidth: 260, borderRight: `1px solid ${borderColor}` }}>
          <KeyBrowser target={target} delimiter={delimiter} onSelectKey={setSelectedKey} reloadSignal={listReload} readonly={readonly} isDark={isDark} />
        </div>
        <div
          className="splitter splitter-v"
          onMouseDown={startDrag}
          style={{ width: 6, flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedKey ? (
            <ValuePanel
              target={target}
              currentKey={selectedKey}
              key={selectedKey}
              readonly={readonly}
              onDelete={() => {
                // Explicit delete: leave the detail panel.
                setSelectedKey("");
                setListReload((n) => n + 1);
              }}
              onMissing={() => {
                // A key expired/removed: refresh the list to drop it, but stay on
                // the detail panel (no forced overview).
                setListReload((n) => n + 1);
              }}
            />
          ) : (
            <ConnInfoPanel target={target} />
          )}
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${borderColor}`,
          height: panelOpen ? panelH : 40,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          // Clip the panel's content (e.g. the white raised table) so it can't
          // overflow upward and cover the list while the panel is resizing.
          overflow: "hidden",
        }}
      >
        {panelOpen && (
          <div
            className="splitter splitter-h"
            onMouseDown={startPanelDrag}
            style={{ height: 5, marginBottom: 0, flexShrink: 0 }}
          />
        )}
        <div
          style={{ height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}
        >
          <Button
            size="small"
            type={panelOpen && terminalOpen ? "primary" : "default"}
            icon={<ConsoleSqlOutlined />}
            onClick={() => {
              // Clicking the tab always opens the terminal sub-panel. Collapsing is
              // only via the top-right close button (removed click-again-to-close).
              setPanelOpen(true);
              setTerminalOpen(true);
              setMonitorOpen(false);
            }}
          >
            Terminal
          </Button>
          <Dropdown
            trigger={["hover"]}
            menu={{
              items: [
                { key: "slowlog", label: "Slow Log", onClick: () => openMonitor("slowlog") },
                { key: "memory", label: "Memory", onClick: () => openMonitor("memory") },
                { key: "clients", label: "Clients", onClick: () => openMonitor("clients") },
                { key: "commands", label: "Commands", onClick: () => openMonitor("commands") },
              ],
            }}
          >
            <Button
              size="small"
              type={panelOpen && monitorOpen ? "primary" : "default"}
              icon={<DashboardOutlined />}
              onClick={() => {
                // Clicking the Monitor tab (when the panel is open) switches back
                // to the Monitor sub-page. Opening from a closed panel requires
                // picking a sub-item from the hover menu. Collapsing is only via
                // the top-right close button.
                if (panelOpen) openMonitor(monitorSub);
              }}
            >
              Monitor
            </Button>
          </Dropdown>
          <div style={{ flex: 1 }} />
          {panelOpen && monitorOpen && monitorSub === "memory" && (
            <Space size={4}>
              <Input
                size="small"
                allowClear
                placeholder="Pattern (blank = all)"
                style={{ width: 200 }}
                value={memoryPattern}
                onChange={(e) => setMemoryPattern(e.target.value)}
                onPressEnter={() => setMemoryAnalyzeSignal((s) => s + 1)}
              />
              <InputNumber
                size="small"
                min={1}
                max={20000}
                value={memorySample}
                onChange={(v) => setMemorySample(Number(v) || 2000)}
                style={{ width: 80 }}
              />
              <Tooltip title="Analyze memory">
                <Button
                  size="small"
                  type="text"
                  icon={<SearchOutlined />}
                  onClick={() => setMemoryAnalyzeSignal((s) => s + 1)}
                />
              </Tooltip>
              {memoryScanned > 0 && (
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {memoryScanned} keys
                </Text>
              )}
            </Space>
          )}
          <div style={{ flex: 1 }} />
          {panelOpen && (
            <Tooltip title="Close panel">
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => {
                  setPanelOpen(false);
                  setTerminalOpen(false);
                  setMonitorOpen(false);
                }}
              />
            </Tooltip>
          )}
        </div>
        {panelOpen && terminalOpen && <TerminalTab target={target} readonly={readonly} />}
        {panelOpen && monitorOpen && (
          <MonitorTab
            target={target}
            sub={monitorSub}
            pattern={memoryPattern}
            sample={memorySample}
            analyzeSignal={memoryAnalyzeSignal}
            onScanned={setMemoryScanned}
          />
        )}
      </div>
    </div>
  );
}
