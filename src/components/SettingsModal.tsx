import { Modal, Form, Slider, Switch, Typography } from "antd";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  onThemeToggle: () => void;
  locale: string;
  zoom: number;
  setZoom: (z: number) => void;
}

export function SettingsModal({ open, onClose, isDark, onThemeToggle, locale, zoom, setZoom }: Props) {
  const zh = locale === "zh-CN";
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={zh ? "Settings" : "Settings"} width={420}>
      <Form labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} style={{ marginTop: 12 }}>
        <Form.Item label={zh ? "Theme" : "Theme"}>
          <Switch
            checked={isDark}
            onChange={onThemeToggle}
            checkedChildren={zh ? "Dark" : "Dark"}
            unCheckedChildren={zh ? "Light" : "Light"}
          />
        </Form.Item>
        <Form.Item label="Zoom">
          <Slider
            min={80}
            max={130}
            step={5}
            value={zoom}
            onChange={setZoom}
            marks={{ 80: "80%", 100: "100%", 130: "130%" }}
          />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {zh ? "Secrets are stored in the OS keyring." : "Secrets are stored in the OS keyring."}
        </Text>
      </Form>
    </Modal>
  );
}
