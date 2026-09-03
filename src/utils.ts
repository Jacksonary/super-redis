export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatTimestamp(secs: number): string {
  if (!secs || secs < 0) return "-";
  const d = new Date(secs * 1000);
  return d.toLocaleString();
}

export function ttlText(ttl: number): string {
  if (ttl === -1) return "永久";
  if (ttl === -2) return "不存在";
  if (ttl >= 60) return `${Math.floor(ttl / 60)}m${ttl % 60}s`;
  return `${ttl}s`;
}

export function isValidJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

export function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function truncate(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
