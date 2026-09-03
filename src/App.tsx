import { useCallback, useEffect, useRef, useState } from "react";
import { Layout, theme, Typography, ConfigProvider, Tooltip, Button } from "antd";
import { DatabaseOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { SettingsModal } from "./components/SettingsModal";
import { TaskPanel } from "./components/TaskPanel";
import type { ConnectionSummary, SelectedTarget, Task } from "./types";
import { api } from "./api";
import { getLocale, setLocale } from "./i18n";
import { useRedisEvent } from "./useRedisEvents";

const { Content } = Layout;
const { Text } = Typography;

export default function App() {
  const [isDark, setIsDark] = useState(() => localStorage.getItem("theme") === "dark");
  const [locale, setLocaleState] = useState(getLocale());
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [selected, setSelected] = useState<SelectedTarget | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [zoom, setZoom] = useState(100);

  const dragging = useRef(false);
  const siderRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const changeLocale = (lang: string) => {
    setLocale(lang);
    setLocaleState(lang);
  };

  useEffect(() => {
    document.documentElement.style.background = isDark ? "#111213" : "#f0f2f5";
    document.body.style.background = isDark ? "#111213" : "#f0f2f5";
  }, [isDark]);

  const refreshConnections = useCallback(() => {
    api
      .listConnections()
      .then((cs) => {
        setConnections(cs);
        if (selected) {
          const stillThere = cs.some((c) => c.id === selected.connectionId);
          if (!stillThere) setSelected(null);
        }
      })
      .catch(() => {});
  }, [selected]);

  useEffect(() => {
    refreshConnections();
    api.getAppSettings().then((s) => {
      setZoom(s.zoomPercent);
      if (s.language) changeLocale(s.language);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resizable sidebar (mirrors super-s3).
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const w = Math.max(200, Math.min(420, e.clientX));
      if (siderRef.current) siderRef.current.style.width = `${w}px`;
      if (contentRef.current) contentRef.current.style.marginLeft = `${w}px`;
      setSidebarWidth(w);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    return () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
  }, []);

  // Global task events.
  useRedisEvent<{ task_id: string; progress: number; total?: number; done?: number; message?: string }>(
    "task-progress",
    (p) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === p.task_id
            ? { ...t, progress: p.progress, total: p.total, done: p.done, message: p.message }
            : t
        )
      );
    }
  );
  useRedisEvent<{ task_id: string; state: string }>("task-state", (p) => {
    const status = p.state as Task["status"];
    setTasks((prev) => prev.map((t) => (t.id === p.task_id ? { ...t, status } : t)));
  });

  // Compute layout colors directly from the theme. `theme.useToken()` yields the
  // DEFAULT (light) tokens when called outside `<ConfigProvider>`, which is why the
  // sidebar and content could end up in different palettes.
  const contentBg = isDark ? "#111213" : "#f0f2f5";
  const borderColor = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)";

  return (
    <div data-theme={isDark ? "dark" : "light"} style={{ zoom: zoom / 100 }}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: isDark ? { colorBgLayout: "#111213" } : { colorBgLayout: "#f0f2f5" },
        }}
      >
        <Layout
          style={{ minHeight: "100vh" }}
          onContextMenu={(e) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
          }}
        >
          <div
            ref={siderRef}
            style={{
              width: collapsed ? 48 : sidebarWidth,
              background: "transparent",
              borderRight: `1px solid ${borderColor}`,
              height: "100vh",
              position: "fixed",
              left: 0,
              top: 0,
              zIndex: 1,
              overflow: "hidden",
            }}
          >
            {collapsed ? (
              <div style={{ paddingTop: 12, textAlign: "center" }}>
                <Tooltip title="Expand sidebar">
                  <Button icon={<MenuUnfoldOutlined />} onClick={() => setCollapsed(false)} />
                </Tooltip>
              </div>
            ) : (
              <Sidebar
                connections={connections}
                selected={selected}
                onSelect={setSelected}
                isDark={isDark}
                onThemeToggle={toggleTheme}
                locale={locale}
                onLocaleChange={changeLocale}
                onConnectionsChange={refreshConnections}
                onOpenSettings={() => setSettingsOpen(true)}
                onCollapse={() => setCollapsed(true)}
              />
            )}
            <div
              onMouseDown={() => {
                dragging.current = true;
                document.body.style.cursor = "col-resize";
                document.body.style.userSelect = "none";
              }}
              style={{ position: "absolute", top: 0, right: 0, width: 4, height: "100%", cursor: "col-resize", zIndex: 10 }}
            />
          </div>

          <div ref={contentRef} style={{ marginLeft: collapsed ? 48 : sidebarWidth }}>
            <Content style={{ background: contentBg, minHeight: "100vh" }}>
              {selected ? (
                <Workspace
                  key={`${selected.connectionId}-${selected.db}`}
                  target={selected}
                  isDark={isDark}
                  onDbChange={(db) => setSelected({ connectionId: selected.connectionId, db })}
                />
              ) : (
                <div className="empty-state-wrap" style={{ height: "100vh", justifyContent: "center" }}>
                  <DatabaseOutlined className="empty-state-icon" />
                  <Text style={{ fontSize: 15, fontWeight: 600 }}>Super Redis</Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {locale === "zh-CN" ? "Choose a connection from the sidebar" : "Choose a connection from the sidebar"}
                  </Text>
                </div>
              )}
            </Content>
          </div>

          <TaskPanel tasks={tasks} onDismiss={(id) => setTasks((p) => p.filter((t) => t.id !== id))} />
        </Layout>

        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          isDark={isDark}
          onThemeToggle={toggleTheme}
          locale={locale}
          zoom={zoom}
          setZoom={(z) => {
            setZoom(z);
            api.getAppSettings().then((s) =>
              api.putAppSettings({ ...s, theme: isDark ? "dark" : "light", zoomPercent: z, language: locale }).catch(() => {})
            );
          }}
        />
      </ConfigProvider>
    </div>
  );
}
