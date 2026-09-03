import { useState } from "react";
import { Segmented } from "antd";
import type { SelectedTarget } from "../types";
import { ServerInfoPanel } from "./ServerInfoPanel";
import { SlowlogPanel } from "./SlowlogPanel";

type SubTab = "info" | "slowlog";

export function MonitorTab({ target }: { target: SelectedTarget }) {
  const [sub, setSub] = useState<SubTab>("info");
  return (
    <div style={{ height: "calc(40vh - 40px)", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "6px 12px" }}>
        <Segmented
          value={sub}
          onChange={(v) => setSub(v as SubTab)}
          options={[
            { label: "Server Info", value: "info" },
            { label: "Slow Log", value: "slowlog" },
          ]}
        />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {sub === "info" ? <ServerInfoPanel target={target} /> : <SlowlogPanel target={target} />}
      </div>
    </div>
  );
}
