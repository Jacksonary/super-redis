import { Modal, Form, Switch, Typography, Select, Button, Space, InputNumber } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { message } from "../antd-app";
import type { AppSettings } from "../types";
import { api } from "../api";

const { Text } = Typography;

// Common key delimiters for folder grouping.
const DELIMITERS = [
  { value: ":", label: ":" },
  { value: ".", label: "." },
  { value: "/", label: "/" },
  { value: "-", label: "-" },
  { value: "_", label: "_" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  onThemeToggle: () => void;
  locale: string;
  settings: AppSettings | null;
  saveSettings: (patch: Partial<AppSettings>) => void;
  onRefreshConnections: () => void;
}

export function SettingsModal({ open, onClose, isDark, onThemeToggle, locale, settings, saveSettings, onRefreshConnections }: Props) {
  const doExport = async () => {
    try {
      const path = await save({
        defaultPath: "super-redis-connections.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Export connections",
      });
      if (!path) return; // user cancelled
      const json = await api.exportConfig();
      await writeTextFile(path, json);
      message.success("exported");
    } catch (e) {
      message.error(String(e));
    }
  };

  const doImport = async () => {
    try {
      const path = await dialogOpen({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Import connections",
      });
      if (!path) return; // user cancelled
      const text = await readTextFile(path as string);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of connections");
      const res = await api.importConfig(parsed);
      message.success(`imported ${res.added}, skipped ${res.skipped} existing`);
      onRefreshConnections();
    } catch (e) {
      message.error(`Import failed: ${String(e)}`);
    }
  };

  return (
    <Modal className="settings-modal" open={open} onCancel={onClose} footer={null} title="Settings" width={460}>
      <Form size="small" labelAlign="left" labelCol={{ span: 10 }} wrapperCol={{ span: 14 }} style={{ marginTop: 12 }}>
        <Form.Item label="Theme">
          <Switch checked={isDark} onChange={onThemeToggle} checkedChildren="Dark" unCheckedChildren="Light" />
        </Form.Item>
        <Form.Item label="Key separator">
          <Select
            value={settings?.keyDelimiter ?? ":"}
            onChange={(v) => saveSettings({ keyDelimiter: v })}
            style={{ width: 120 }}
            options={DELIMITERS}
          />
        </Form.Item>

        <div className="settings-cascade">
          <Form.Item label="Batch operation">
            <span />
          </Form.Item>
          <Form.Item label={<span className="settings-indent">Size</span>}>
            <InputNumber
              min={1}
              precision={0}
              value={settings?.scanCount ?? 500}
              onChange={(v) => saveSettings({ scanCount: Number(v) || 1 })}
              style={{ width: 120 }}
            />
          </Form.Item>
          <Form.Item label={<span className="settings-indent">Interval (ms)</span>}>
            <InputNumber
              min={0}
              precision={0}
              value={settings?.operateIntervalMs ?? 50}
              onChange={(v) => saveSettings({ operateIntervalMs: Number(v) || 0 })}
              style={{ width: 120 }}
            />
          </Form.Item>
        </div>
        <Form.Item label="Allow multiple instances">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, lineHeight: 1 }}>
            <Switch
              checked={settings?.allowMultiInstance ?? false}
              onChange={(v) => saveSettings({ allowMultiInstance: v })}
            />
            <Text type="secondary" style={{ fontSize: 11, lineHeight: 1 }}>Restart required</Text>
          </span>
        </Form.Item>

        <Form.Item label="Config">
          <Space>
            <Button size="small" icon={<DownloadOutlined />} onClick={doExport}>
              Export
            </Button>
            <Button size="small" icon={<UploadOutlined />} onClick={doImport}>
              Import
            </Button>
          </Space>
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Secrets are stored in the OS keyring and excluded from export. Batch size
          and interval apply to SCAN and DEL operations.
        </Text>
      </Form>

    </Modal>
  );
}
