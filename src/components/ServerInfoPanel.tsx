import { useEffect, useState } from "react";
import { Spin, Typography } from "antd";
import { message } from "../antd-app";
import type { SelectedTarget } from "../types";
import { api } from "../api";

const { Text } = Typography;

export function ServerInfoPanel({ target }: { target: SelectedTarget }) {
  const [info, setInfo] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getServerInfo(target.connectionId)
      .then(setInfo)
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [target.connectionId]);

  if (loading) return <Spin style={{ margin: 24 }} />;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 8 }}>
      <Text strong>Server Info</Text>
      <pre className="mono" style={{ marginTop: 8, fontSize: 11.5, whiteSpace: "pre-wrap" }}>
        {info == null ? "(no data)" : typeof info === "string" ? info : JSON.stringify(info, null, 2)}
      </pre>
    </div>
  );
}
