import { useEffect, useState } from "react";
import { Modal, Form, Input, InputNumber, Select, Switch, Row, Col, Spin, Button, Collapse, Space, AutoComplete, Dropdown } from "antd";
import { FolderOpenOutlined, DownOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import type { Connection, ConnectionSummary } from "../types";
import { api } from "../api";

const { Panel } = Collapse;

interface Props {
  open: boolean;
  initialSummary: ConnectionSummary | null;
  onClose: () => void;
  onSaved: () => void;
  locale: string;
}

// Connection colors: readable on both themes, and distinct from the connection
// status colors (success green #52c41a, error red #ff4d4f, neutral grey #8c8c8c).
const PRESET_COLORS: { value: string; name: string }[] = [
  { value: "#e1683a", name: "Orange" },
  { value: "#13c2c2", name: "Teal" },
  { value: "#1677ff", name: "Blue" },
  { value: "#722ed1", name: "Iris" },
  { value: "#eb2f96", name: "Purple" },
  { value: "#a8071a", name: "Red" },
  { value: "#2f54eb", name: "Indigo" },
  { value: "#7cb305", name: "Lime" },
  { value: "#08979c", name: "Cyan" },
  { value: "#003eb3", name: "Navy" },
  { value: "#fadb14", name: "Yellow" },
  { value: "#531dab", name: "Violet" },
];

const MODE_LABELS: Record<string, string> = {
  standalone: "Standalone",
  cluster: "Cluster",
  sentinel: "Sentinel",
};

// A file picker that fills the field's value. SSL cert/key are file paths.
function FileField({ label, placeholder, name, form }: { label: string; placeholder?: string; name: string; form: ReturnType<typeof Form.useForm>[0] }) {
  const pick = async () => {
    const sel = await open({ multiple: false, directory: false, title: `Select ${label}` });
    if (typeof sel === "string") form.setFieldValue(name, sel);
  };
  return (
    <Form.Item label={label}>
      <Space.Compact style={{ width: "100%" }}>
        <Form.Item name={name} noStyle>
          <Input placeholder={placeholder ?? "/path/to/file"} style={{ width: "100%" }} />
        </Form.Item>
        <Button icon={<FolderOpenOutlined />} onClick={pick} />
      </Space.Compact>
    </Form.Item>
  );
}

export function ConnectionForm({ open, initialSummary, onClose, onSaved, locale }: Props) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const mode = Form.useWatch("mode", form) || "standalone";
  const [modeVal, setModeVal] = useState(mode);
  const tls = Form.useWatch("tls", form);

  useEffect(() => {
    if (open) {
      // Group options come from the group values already used by connections
      // (the sidebar groups by conn.group), so existing groups are selectable
      // even when connection_groups (structured definitions) is empty.
      api.getConfig()
        .then((all) => {
          const names = all.map((c) => c.group).filter(Boolean) as string[];
          setGroupOptions(Array.from(new Set(names)));
        })
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      form.resetFields();
      (async () => {
        let full: Connection | undefined;
        try {
          if (initialSummary?.id) {
            const all = await api.getConfig();
            full = all.find((c) => c.id === initialSummary.id);
          }
        } catch {
          /* ignore */
        }
        const modeInit = full?.mode ?? "standalone";
        setModeVal(modeInit);
        form.setFieldsValue({
          name: initialSummary?.name ?? full?.name ?? "",
          host: full?.host ?? "127.0.0.1",
          port: full?.port ?? 6379,
          db: full?.db ?? 0,
          mode: modeInit,
          readonly: full?.readonly ?? false,
          group: full?.group ?? "",
          color: full?.color ?? "none",
          timeoutMs: full?.timeout_ms ?? 1000,
          user: full?.acl.username ?? "",
          password: full?.acl.password ?? "",
          clusterNodes: (full?.cluster.nodes ?? []).join(", "),
          sentinelMaster: full?.sentinel.masterName ?? "mymaster",
          sentinelNodes: (full?.sentinel.nodes ?? []).join(", "),
          tls: full?.tls.enabled ?? false,
          caCertFile: full?.tls.caCertFile ?? "",
          clientCertFile: full?.tls.clientCertFile ?? "",
          clientKeyFile: full?.tls.clientKeyFile ?? "",
          skipVerify: full?.tls.skipVerify ?? false,
          serverName: full?.tls.serverName ?? "",
        });
      })();
    }
  }, [open, initialSummary, form]);

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const mode = values.mode as string;
      const conn: Connection = {
        id: initialSummary?.id,
        name: values.name,
        host: values.host,
        port: values.port,
        db: values.db ?? 0,
        mode,
        readonly: !!values.readonly,
        timeout_ms: values.timeoutMs ?? 1000,
        color: values.color === "none" ? undefined : values.color,
        group: values.group || null,
        acl: { enabled: !!values.password, username: values.user || "", password: values.password || "" },
        tls: {
          enabled: !!values.tls,
          caCertFile: values.caCertFile || null,
          clientCertFile: values.clientCertFile || null,
          clientKeyFile: values.clientKeyFile || null,
          keyPassphrase: "",
          skipVerify: !!values.skipVerify,
          serverName: values.serverName || null,
        },
        cluster: { nodes: values.clusterNodes ? values.clusterNodes.split(",").map((s: string) => s.trim()).filter(Boolean) : [] },
        sentinel: { masterName: values.sentinelMaster || "mymaster", nodes: values.sentinelNodes ? values.sentinelNodes.split(",").map((s: string) => s.trim()).filter(Boolean) : [], password: "" },
        ssh: { enabled: false, port: 22, remotePort: 6379, password: "" },
        startup_commands: [],
        encoding: "utf-8",
      };
      if (initialSummary?.id) {
        await api.updateConnection(conn);
      } else {
        await api.createConnection(conn);
      }
      onSaved();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span>{initialSummary ? "Edit Connection" : "New Connection"}</span>
          <Dropdown
            menu={{
              items: [
                { key: "standalone", label: "Standalone" },
                { key: "cluster", label: "Cluster" },
                { key: "sentinel", label: "Sentinel" },
              ],
              selectable: true,
              selectedKeys: [modeVal],
              onClick: ({ key }) => {
                setModeVal(key);
                form.setFieldValue("mode", key);
              },
            }}
            trigger={["click"]}
          >
            <Button type="text" size="small" style={{ height: "auto", padding: "0 4px", fontSize: 13 }}>
              {MODE_LABELS[modeVal] ?? "Standalone"} <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </div>
      }
      okText="Save"
      cancelText="Cancel"
      onOk={save}
      onCancel={onClose}
      confirmLoading={saving}
      width={600}
      className="conn-form"
      styles={{ body: { paddingTop: 8 } }}
    >
      <Form form={form} layout="vertical" size="small" requiredMark={false}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="name" label="Name" style={{ marginBottom: 8 }}>
              <Input placeholder="my connection" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="group" label="Group" style={{ marginBottom: 8 }}>
              <AutoComplete
                placeholder="e.g. production"
                options={groupOptions.map((g) => ({ value: g }))}
                filterOption={(input, option) => (option?.value ?? "").toLowerCase().includes(input.toLowerCase())}
                onChange={(v) => form.setFieldValue("group", v)}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="host" label="Host" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="port" label="Port">
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="user" label="Username (ACL)">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="password" label="Password">
              <Input.Password />
            </Form.Item>
          </Col>
        </Row>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, paddingTop: 4 }}>
          <span style={{ fontSize: 14 }}>SSL/TLS</span>
          <Form.Item name="tls" valuePropName="checked" noStyle>
            <Switch />
          </Form.Item>
        </div>

        {tls && (
          <>
            <FileField name="caCertFile" label="CA certificate" form={form} />
            <Row gutter={12}>
              <Col span={12}>
                <FileField name="clientCertFile" label="Client certificate" form={form} />
              </Col>
              <Col span={12}>
                <FileField name="clientKeyFile" label="Client key" form={form} />
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="serverName" label="Server name (SNI)">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="skipVerify" label="Skip verify" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}

        <Collapse ghost size="small" className="conn-advanced" expandIconPosition="end" style={{ marginTop: 8 }}>
          <Panel header="Advanced options" key="advanced">
            <Row gutter={12}>
              {modeVal !== "cluster" && (
                <Col span={12}>
                  <Form.Item name="db" label="Default DB">
                    <InputNumber min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              )}
              <Col span={12}>
                <Form.Item name="readonly" label="Read only" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item name="color" label="Color">
                  <Select
                    allowClear
                    options={[
                      { value: "none", label: "No Color" },
                      ...PRESET_COLORS.map((c) => ({ value: c.value, label: c.name })),
                    ]}
                    optionRender={(o) => {
                      const val = o.value as string;
                      const isNone = !val || val === "none";
                      const dot = !isNone ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: val,
                            flexShrink: 0,
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: "1.5px solid rgba(128,128,128,0.7)",
                            background:
                              "linear-gradient(45deg, transparent 46%, rgba(128,128,128,0.7) 47%, rgba(128,128,128,0.7) 53%, transparent 54%)",
                            flexShrink: 0,
                          }}
                        />
                      );
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {dot}
                          {o.label}
                        </span>
                      );
                    }}
                    labelRender={({ value }) => {
                      const hex = value as string;
                      const isNone = !hex || hex === "none";
                      const name = PRESET_COLORS.find((c) => c.value === hex)?.name;
                      const dot = !isNone ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: hex,
                            flexShrink: 0,
                            verticalAlign: "middle",
                          }}
                        />
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: "1.5px solid rgba(128,128,128,0.7)",
                            background:
                              "linear-gradient(45deg, transparent 46%, rgba(128,128,128,0.7) 47%, rgba(128,128,128,0.7) 53%, transparent 54%)",
                            flexShrink: 0,
                            verticalAlign: "middle",
                          }}
                        />
                      );
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          {dot}
                          {name ?? "No Color"}
                        </span>
                      );
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="timeoutMs" label="Timeout (ms)">
                  <InputNumber min={100} step={100} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>

            {modeVal === "cluster" && (
              <Form.Item name="clusterNodes" label="Cluster nodes (host:port, comma-separated)">
                <Input placeholder="127.0.0.1:6379, 127.0.0.1:6380" />
              </Form.Item>
            )}
            {modeVal === "sentinel" && (
              <>
                <Form.Item name="sentinelMaster" label="Sentinel master name">
                  <Input />
                </Form.Item>
                <Form.Item name="sentinelNodes" label="Sentinel nodes (host:port, comma-separated)">
                  <Input />
                </Form.Item>
              </>
            )}
          </Panel>
        </Collapse>
      </Form>
      {saving && <Spin />}
    </Modal>
  );
}
