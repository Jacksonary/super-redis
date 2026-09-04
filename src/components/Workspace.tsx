import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Typography, Breadcrumb } from "antd";
import { ConsoleSqlOutlined, DashboardOutlined, HomeOutlined, DownOutlined } from "@ant-design/icons";
import type { SelectedTarget } from "../types";
import { api } from "../api";
import { KeyBrowser } from "./KeyBrowser";
import { ValuePanel } from "./ValuePanel";
import { ConnInfoPanel } from "./ConnInfoPanel";
import { TerminalTab } from "./TerminalTab";
import { MonitorTab } from "./MonitorTab";

const { Text } = Typography;

export function Workspace({ target, connectionName, delimiter, isDark, onDbChange }: { target: SelectedTarget; connectionName: string; delimiter: string; isDark: boolean; onDbChange: (db: number) => void }) {
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.42);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [dbCount, setDbCount] = useState(0);
  const [panelH, setPanelH] = useState(260); // bottom terminal/monitor panel height (px)
  const [panelOpen, setPanelOpen] = useState(false);
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
                <Text style={{ fontSize: 12.5 }}>
                  {connectionName || "Connection"}
                </Text>
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
                  <Text style={{ fontSize: 12.5, cursor: "pointer" }} onClick={(e) => e.preventDefault()}>
                    DB{target.db} <DownOutlined style={{ fontSize: 9, opacity: 0.55 }} />
                  </Text>
                </Dropdown>
              ),
            },
            ...(selectedKey
              ? [{ title: <Text className="mono" style={{ fontSize: 12.5 }}>{selectedKey}</Text> }]
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
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: `${splitRatio * 100}%`, minWidth: 260, borderRight: `1px solid ${borderColor}` }}>
          <KeyBrowser target={target} delimiter={delimiter} onSelectKey={setSelectedKey} reloadSignal={listReload} />
        </div>
        <div
          onMouseDown={startDrag}
          style={{ width: 6, cursor: "col-resize", background: "transparent", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedKey ? (
            <ValuePanel
              target={target}
              currentKey={selectedKey}
              key={selectedKey}
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

      <div style={{ borderTop: `1px solid ${borderColor}`, height: panelOpen ? panelH : 40, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        {panelOpen && (
          <div
            onMouseDown={startPanelDrag}
            style={{ height: 5, cursor: "row-resize", background: "transparent", marginBottom: 0, flexShrink: 0 }}
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
              // Clicking the already-active tab collapses the panel; otherwise open it
              // (never leaves the panel open with no tab content, which shows a floating gap).
              if (panelOpen && terminalOpen) {
                setPanelOpen(false);
                setTerminalOpen(false);
                setMonitorOpen(false);
              } else {
                setPanelOpen(true);
                setTerminalOpen(true);
                setMonitorOpen(false);
              }
            }}
          >
            Terminal
          </Button>
          <Button
            size="small"
            type={panelOpen && monitorOpen ? "primary" : "default"}
            icon={<DashboardOutlined />}
            onClick={() => {
              if (panelOpen && monitorOpen) {
                setPanelOpen(false);
                setTerminalOpen(false);
                setMonitorOpen(false);
              } else {
                setPanelOpen(true);
                setMonitorOpen(true);
                setTerminalOpen(false);
              }
            }}
          >
            Monitor
          </Button>
        </div>
        {panelOpen && terminalOpen && <TerminalTab target={target} />}
        {panelOpen && monitorOpen && <MonitorTab target={target} />}
      </div>
    </div>
  );
}
