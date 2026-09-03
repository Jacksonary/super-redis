import { useState } from "react";
import { Button, Progress, Tag, Popover, List, Typography } from "antd";
import { NotificationOutlined, CloseOutlined } from "@ant-design/icons";
import type { Task } from "../types";

const { Text } = Typography;

interface Props {
  tasks: Task[];
  onDismiss: (id: string) => void;
}

const statusColor: Record<Task["status"], string> = {
  running: "processing",
  done: "success",
  paused: "warning",
  cancelled: "default",
  error: "error",
};

export function TaskPanel({ tasks, onDismiss }: Props) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;

  const active = tasks.filter((t) => t.status === "running");
  const content = (
    <div style={{ width: 320 }}>
      <List
        size="small"
        dataSource={tasks}
        renderItem={(t) => (
          <List.Item
            style={{ display: "flex", alignItems: "center", gap: 8 }}
            actions={[
              <Button
                key="x"
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => onDismiss(t.id)}
              />,
            ]}
          >
            <List.Item.Meta
              title={<Text style={{ fontSize: 12 }}>{t.title}</Text>}
              description={<Progress size="small" percent={t.progress} status={statusColor[t.status] as any} />}
            />
          </List.Item>
        )}
      />
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      content={content}
      title={<Text style={{ fontSize: 13 }}>Tasks / 任务</Text>}
    >
      <div
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 1000,
          cursor: "pointer",
        }}
      >
        <Button shape="round" icon={<NotificationOutlined />} type="primary">
          {active.length > 0 ? active.length : <Tag color={statusColor[tasks[tasks.length - 1].status]}>{tasks.length}</Tag>}
        </Button>
      </div>
    </Popover>
  );
}
