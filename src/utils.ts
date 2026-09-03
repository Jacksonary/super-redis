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
 * Each segment becomes a folder node; the real key is always the leaf's `key` so it
 * stays openable. Empty segments (leading / trailing / consecutive delimiters) are
 * dropped so no empty-title folder is produced.
 */
export function groupKeys(keys: string[], delimiter: string): KeyTreeNode[] {
  type N = { key: string; title: string; children: Record<string, N> };
  const root: Record<string, N> = {};
  const collect = (raw: string, segs: string[]) => {
    let cur = root;
    let path = "";
    for (let i = 0; i < segs.length; i++) {
      path = i === 0 ? segs[0] : path + delimiter + segs[i];
      if (!cur[path]) cur[path] = { key: path, title: segs[i], children: {} };
      if (i < segs.length - 1) cur = cur[path].children;
    }
    const leaf = cur[path];
    leaf.key = raw; // open the real key (may contain the delimiter)
    leaf.title = segs[segs.length - 1];
  };
  for (const raw of keys) {
    const segs = raw.split(delimiter).filter((s) => s !== "");
    if (segs.length > 0) collect(raw, segs);
  }
  const convert = (m: Record<string, N>): KeyTreeNode[] =>
    Object.keys(m)
      .map((p) => {
        const node = m[p];
        const children = convert(node.children);
        return {
          key: node.key,
          title: node.title,
          children: children.length ? children : undefined,
          isLeaf: children.length === 0,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  return convert(root);
}
