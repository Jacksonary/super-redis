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
  if (ttl === -1) return "permanent";
  if (ttl === -2) return "missing";
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

/** A node in the folder/tree key view. `key` is the full path, `title` the last segment. */
export interface KeyTreeNode {
  key: string;
  title: string;
  isLeaf?: boolean;
  children?: KeyTreeNode[];
}

/**
 * Group a flat list of Redis keys into a folder tree by a delimiter (default ":").
 * Each segment becomes a folder node; the full key path becomes a leaf.
 */
export function groupKeys(keys: string[], delimiter: string): KeyTreeNode[] {
  const root: Record<string, Record<string, unknown> & { children: Record<string, unknown> }> = {};
  for (const k of keys) {
    const segs = k.split(delimiter);
    let cur = root as Record<string, Record<string, unknown> & { children: Record<string, unknown> }>;
    let path = "";
    for (let i = 0; i < segs.length; i++) {
      path = i === 0 ? segs[0] : path + delimiter + segs[i];
      if (!cur[path]) cur[path] = { children: {} };
      if (i < segs.length - 1) cur = cur[path].children as typeof cur;
    }
  }
  const convert = (m: Record<string, Record<string, unknown> & { children: Record<string, unknown> }>): KeyTreeNode[] =>
    Object.keys(m)
      .map((p) => {
        const children = convert(m[p].children as typeof m);
        return {
          key: p,
          title: p.split(delimiter).pop() || p,
          children: children.length ? children : undefined,
          isLeaf: children.length === 0,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  return convert(root);
}
