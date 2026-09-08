import type { SelectedTarget } from "../types";
import { SlowlogPanel } from "./SlowlogPanel";
import { MemoryPanel } from "./MemoryPanel";
import { ClientsPanel } from "./ClientsPanel";
import { CommandStatsPanel } from "./CommandStatsPanel";

export type MonitorSub = "slowlog" | "memory" | "clients" | "commands";

// The sub-page is controlled by the Workspace (the Monitor button in the bottom
// bar is the entry point); the panel body just renders the active sub-page, so
// the in-panel Segmented row is gone and the height goes to content.
export function MonitorTab({
  target,
  sub,
  pattern,
  sample,
  analyzeSignal,
  onScanned,
}: {
  target: SelectedTarget;
  sub: MonitorSub;
  pattern: string;
  sample: number;
  analyzeSignal: number;
  onScanned: (n: number) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {sub === "slowlog" ? (
        <SlowlogPanel target={target} />
      ) : sub === "memory" ? (
        <MemoryPanel target={target} pattern={pattern} sample={sample} analyzeSignal={analyzeSignal} onScanned={onScanned} />
      ) : sub === "clients" ? (
        <ClientsPanel target={target} />
      ) : (
        <CommandStatsPanel target={target} />
      )}
    </div>
  );
}
