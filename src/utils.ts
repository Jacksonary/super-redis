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
 *
 * Every key is preserved as a leaf (its `key` is the real Redis key), so keys that
 * differ only by empty segments (`a:b` vs `a::b`) never collapse. A node that is
 * both a real key and a prefix of others is shown as an expandable folder that is
 * still selectable (clicking its title opens the key's value). Empty segments are
 * kept and titled with the delimiter so no key is lost to an empty-title node.
 */
export function groupKeys(keys: string[], delimiter: string): KeyTreeNode[] {
  type N = { key: string; title: string; children: Record<string, N>; isKey: boolean };
  const root: Record<string, N> = {};
  for (const raw of keys) {
    if (raw === "") continue;
    const segs = raw.split(delimiter);
    let cur = root;
    let path = "";
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      path = i === 0 ? seg : path + delimiter + seg;
      if (!cur[path]) cur[path] = { key: path, title: seg, children: {}, isKey: false };
      if (i < segs.length - 1) cur = cur[path].children;
    }
    cur[path].isKey = true;
  }
  const convert = (m: Record<string, N>): KeyTreeNode[] => {
    const out: KeyTreeNode[] = [];
    for (const p of Object.keys(m)) {
      const node = m[p];
      const children = convert(node.children);
      const title = node.title === "" ? delimiter : node.title;
      if (node.isKey) {
        // The real key always appears as its own leaf.
        out.push({ key: node.key, title, isLeaf: true });
        // If it is ALSO a prefix of other keys, show a separate folder node so the
        // key and the folder don't get merged into one ambiguous node.
        if (children.length) {
          out.push({ key: node.key + delimiter, title, isLeaf: false, children });
        }
      } else if (children.length) {
        out.push({ key: node.key, title, isLeaf: false, children });
      } else {
        out.push({ key: node.key, title, isLeaf: true });
      }
    }
    // Folders first, then leaves; each group sorted alphabetically by title.
    return out.sort((a, b) => {
      const aFolder = !!a.children;
      const bFolder = !!b.children;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
    });
  };
  return convert(root);
}
