import { useState } from "react";
import { Modal, Form, Switch, Typography, Select, Input, Button, Space, InputNumber } from "antd";
import { message } from "../antd-app";
import { CopyOutlined, DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import type { AppSettings } from "../types";
import { api } from "../api";

const { Text } = Typography;
const { TextArea } = Input;

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
  const [exportText, setExportText] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const doExport = async () => {
    try {
      const json = await api.exportConfig();
      setExportText(json);
      setExportOpen(true);
    } catch (e) {
      message.error(String(e));
    }
  };

  const doImport = async () => {
    try {
      const parsed = JSON.parse(importText);
      if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of connections");
      await api.putConfig(parsed);
      message.success("imported");
      setImportOpen(false);
      setImportText("");
      onRefreshConnections();
    } catch (e) {
      message.error(`Import failed: ${String(e)}`);
    }
  };

  const copyExport = async () => {
    await navigator.clipboard.writeText(exportText);
    message.success("copied");
  };

  return (
    <Modal className="settings-modal" open={open} onCancel={onClose} footer={null} title="Settings" width={460}>
      <Form size="small" labelAlign="left" labelCol={{ span: 12 }} wrapperCol={{ span: 12 }} style={{ marginTop: 12 }}>
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Switch
              checked={settings?.allowMultiInstance ?? false}
              onChange={(v) => saveSettings({ allowMultiInstance: v })}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>Restart required</Text>
          </span>
        </Form.Item>

        <Form.Item label="Config">
          <Space>
            <Button size="small" icon={<DownloadOutlined />} onClick={doExport}>
              Export
            </Button>
            <Button size="small" icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
          </Space>
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Secrets are stored in the OS keyring and excluded from export. Batch size
          and interval apply to SCAN and DEL operations.
        </Text>
      </Form>

      {/* Export result */}
      <Modal
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        footer={
          <Space>
            <Button icon={<CopyOutlined />} onClick={copyExport}>
              Copy
            </Button>
            <Button onClick={() => setExportOpen(false)}>Close</Button>
          </Space>
        }
        width={520}
        title="Export configuration"
      >
        <TextArea value={exportText} readOnly rows={12} style={{ fontFamily: "monospace", fontSize: 12 }} />
      </Modal>

      {/* Import input */}
      <Modal
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        onOk={doImport}
        okText="Import"
        cancelText="Cancel"
        width={520}
        title="Import configuration"
      >
        <TextArea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={12}
          placeholder='Paste exported JSON, e.g. [{"name": ...}]'
          style={{ fontFamily: "monospace", fontSize: 12 }}
        />
      </Modal>
    </Modal>
  );
}
