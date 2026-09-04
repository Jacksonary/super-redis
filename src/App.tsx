import { useCallback, useEffect, useRef, useState } from "react";
import { Layout, theme, Typography, ConfigProvider, Tooltip, Button, App as AntApp } from "antd";
import { DatabaseOutlined, MenuUnfoldOutlined, SettingOutlined } from "@ant-design/icons";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { SettingsModal } from "./components/SettingsModal";
import { TaskPanel } from "./components/TaskPanel";
import type { AppSettings, ConnectionSummary, SelectedTarget, Task } from "./types";
import { api } from "./api";
import { getLocale, setLocale } from "./i18n";
import { useRedisEvent } from "./useRedisEvents";
import AntdAppBridge from "./antd-app";

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
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);

  const dragging = useRef(false);
  const siderRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Remember the last-selected DB per connection so that switching away and back
  // keeps the chosen DB (instead of resetting to the connection's default db).
  const lastDbRef = useRef<Map<string, number>>(new Map());

  const selectConnection = (t: SelectedTarget) => {
    lastDbRef.current.set(t.connectionId, t.db);
    setSelected(t);
  };

  const changeDb = (connId: string, db: number) => {
    lastDbRef.current.set(connId, db);
    setSelected({ connectionId: connId, db });
  };

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const changeLocale = (lang: string) => {
    setLocale(lang);
    setLocaleState(lang);
  };

  // Persist app settings; keep the in-memory copy in sync.
  const saveSettings = useCallback((patch: Partial<AppSettings>) => {
    setAppSettings((prev) => {
      const next = { ...(prev ?? {}), ...patch } as AppSettings;
      api.putAppSettings(next).catch(() => {});
      return next;
    });
  }, []);

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
      setAppSettings(s);
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
      document.body.classList.remove("dragging");
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
    <div data-theme={isDark ? "dark" : "light"}>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: isDark ? { colorBgLayout: "#111213" } : { colorBgLayout: "#f0f2f5" },
          components: {
            Segmented: {
              // Selected segment uses a semi-transparent primary blue so it stands
              // out in both themes while letting the layout background show through,
              // instead of a hard solid that fights the theme. Driven via the token
              // so antd's own CSS-in-JS can't overwrite it.
              itemSelectedBg: isDark ? "rgba(76, 155, 250, 0.28)" : "rgba(22, 119, 255, 0.18)",
              itemSelectedColor: isDark ? "rgba(255, 255, 255, 0.92)" : "#1677ff",
            },
          },
        }}
      >
        <AntApp>
          <AntdAppBridge />
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
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 0", gap: 8 }}>
                <Tooltip title="Settings">
                  <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} />
                </Tooltip>
                <div style={{ flex: 1 }} />
                <Tooltip title="Expand sidebar">
                  <Button icon={<MenuUnfoldOutlined />} onClick={() => setCollapsed(false)} />
                </Tooltip>
              </div>
            ) : (
              <Sidebar
                connections={connections}
                selected={selected}
                onSelect={(t) => {
                  if (!t) return setSelected(null);
                  // Prefer the remembered DB for this connection, if any.
                  const remembered = lastDbRef.current.get(t.connectionId);
                  selectConnection(remembered !== undefined ? { ...t, db: remembered } : t);
                }}
                isDark={isDark}
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
                document.body.classList.add("dragging");
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
                  connectionName={connections.find((c) => c.id === selected.connectionId)?.name ?? ""}
                  delimiter={appSettings?.keyDelimiter ?? ":"}
                  isDark={isDark}
                  onDbChange={(db) => changeDb(selected.connectionId, db)}
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
            settings={appSettings}
            saveSettings={saveSettings}
            onRefreshConnections={refreshConnections}
          />
        </AntApp>
      </ConfigProvider>
    </div>
  );
}
