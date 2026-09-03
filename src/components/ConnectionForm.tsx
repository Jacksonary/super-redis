import { useEffect, useState } from "react";
import { Modal, Form, Input, InputNumber, Select, Switch, Row, Col, Spin } from "antd";
import type { Connection, ConnectionSummary } from "../types";
import { api } from "../api";

interface Props {
  open: boolean;
  initialSummary: ConnectionSummary | null;
  onClose: () => void;
  onSaved: () => void;
  locale: string;
}

const zh = (l: string) => l === "zh-CN";

export function ConnectionForm({ open, initialSummary, onClose, onSaved, locale }: Props) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({
        name: initialSummary?.name ?? "",
        host: "127.0.0.1",
        port: 6379,
        db: 0,
        mode: "standalone",
        user: "default",
        password: "",
        clusterNodes: "",
        sentinelMaster: "mymaster",
        sentinelNodes: "",
        tls: false,
      });
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
        readonly: false,
        timeout_ms: 10000,
        color: "#4C9BFA",
        acl: { enabled: !!values.password, username: values.user || "default", password: values.password || "" },
        tls: { enabled: !!values.tls, keyPassphrase: "" , skipVerify: false },
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
      title={zh(locale) ? (initialSummary ? "编辑连接" : "新增连接") : initialSummary ? "Edit Connection" : "New Connection"}
      okText={zh(locale) ? "保存" : "Save"}
      cancelText={zh(locale) ? "取消" : "Cancel"}
      onOk={save}
      onCancel={onClose}
      confirmLoading={saving}
      width={560}
    >
      <Form form={form} layout="vertical" size="small">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="name" label={zh(locale) ? "名称" : "Name"}>
              <Input placeholder={`127.0.0.1:6379`} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="mode" label={zh(locale) ? "连接模式" : "Mode"}>
              <Select
                options={[
                  { value: "standalone", label: zh(locale) ? "单机" : "Standalone" },
                  { value: "cluster", label: zh(locale) ? "集群" : "Cluster" },
                  { value: "sentinel", label: zh(locale) ? "哨兵" : "Sentinel" },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={16}>
            <Form.Item name="host" label={zh(locale) ? "主机" : "Host"} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="port" label={zh(locale) ? "端口" : "Port"}>
              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="user" label={zh(locale) ? "用户名 (ACL)" : "Username (ACL)"}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="password" label={zh(locale) ? "密码" : "Password"}>
              <Input.Password />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="db" label={zh(locale) ? "默认 DB" : "Default DB"}>
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="tls" label="SSL/TLS" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="clusterNodes" label={zh(locale) ? "集群节点 (host:port, 逗号分隔)" : "Cluster nodes (host:port, comma-separated)"}>
          <Input placeholder={zh(locale) ? "127.0.0.1:6379, 127.0.0.1:6380" : "127.0.0.1:6379, 127.0.0.1:6380"} />
        </Form.Item>
        <Form.Item name="sentinelMaster" label={zh(locale) ? "哨兵主节点名" : "Sentinel master name"}>
          <Input />
        </Form.Item>
        <Form.Item name="sentinelNodes" label={zh(locale) ? "哨兵节点 (host:port, 逗号分隔)" : "Sentinel nodes (host:port, comma-separated)"}>
          <Input />
        </Form.Item>
      </Form>
      {saving && <Spin />}
    </Modal>
  );
}
