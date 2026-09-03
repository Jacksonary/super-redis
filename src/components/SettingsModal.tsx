import { Modal, Form, Select, Slider, Switch, Typography } from "antd";
import { setLocale } from "../i18n";

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  isDark: boolean;
  onThemeToggle: () => void;
  locale: string;
  onLocaleChange: (l: string) => void;
  zoom: number;
  setZoom: (z: number) => void;
}

export function SettingsModal({ open, onClose, isDark, onThemeToggle, locale, onLocaleChange, zoom, setZoom }: Props) {
  const zh = locale === "zh-CN";
  return (
    <Modal open={open} onCancel={onClose} footer={null} title={zh ? "设置" : "Settings"} width={420}>
      <Form labelCol={{ span: 6 }} wrapperCol={{ span: 18 }} style={{ marginTop: 12 }}>
        <Form.Item label={zh ? "主题" : "Theme"}>
          <Switch
            checked={isDark}
            onChange={onThemeToggle}
            checkedChildren={zh ? "暗色" : "Dark"}
            unCheckedChildren={zh ? "浅色" : "Light"}
          />
        </Form.Item>
        <Form.Item label={zh ? "语言" : "Language"}>
          <Select
            value={locale}
            style={{ width: 180 }}
            onChange={(v) => {
              setLocale(v);
              onLocaleChange(v);
            }}
            options={[
              { value: "zh-CN", label: "简体中文" },
              { value: "en", label: "English" },
            ]}
          />
        </Form.Item>
        <Form.Item label={zh ? "界面缩放" : "Zoom"}>
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
          {zh ? "密码等敏感信息仅保存在系统钥匙串中。" : "Secrets are stored in the OS keyring."}
        </Text>
      </Form>
    </Modal>
  );
}
