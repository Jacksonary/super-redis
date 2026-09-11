import { App } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import type { ModalStaticFunctions } from "antd/es/modal/confirm";
import type { NotificationInstance } from "antd/es/notification/interface";

// antd v5 static `message` / `Modal.confirm` render in their own React root and
// do NOT consume the <ConfigProvider> theme — so they stay light (white) even in
// dark mode. The fix is to use the `<App>` component and `App.useApp()` to get
// context-aware instances. This module captures those instances once (mounted
// inside <ConfigProvider><App>) and re-exports them so the rest of the app can
// use them anywhere while still following the active theme.

let rawMessage: MessageInstance;
let notification: NotificationInstance;
let modal: Omit<ModalStaticFunctions, "warn">;

// Selecting a connection fans out to several panels at once (key list, server
// info, db count, memory…). When the connection is down they all fail with the
// same string at the same moment, and each one calling message.error() stacked
// four identical toasts over the UI. Collapse repeats of the same text inside a
// short window — the first one through wins, the rest are dropped.

const DUPLICATE_WINDOW_MS = 2500;
const lastShownAt = new Map<string, number>();

function errorOnce(content: unknown, ...rest: unknown[]) {
  if (typeof content !== "string") {
    // Nodes and config objects have no cheap identity; pass them through.
    return (rawMessage.error as (...a: unknown[]) => unknown)(content, ...rest);
  }
  // Match on the shape of the message, not its exact text. Backend errors embed
  // varying numbers — a TLS expiry failure carries the current unix time and an
  // "N seconds ago" count, so two reports of the *same* problem one second apart
  // are different strings and would both slip through an equality check.
  const shape = content.replace(/\d+/g, "#");
  const now = Date.now();
  const previous = lastShownAt.get(shape);
  if (previous !== undefined && now - previous < DUPLICATE_WINDOW_MS) return;
  lastShownAt.set(shape, now);
  if (lastShownAt.size > 64) {
    for (const [text, at] of lastShownAt) {
      if (now - at >= DUPLICATE_WINDOW_MS) lastShownAt.delete(text);
    }
  }
  return rawMessage.open({ key: shapeKey(shape), type: "error", content });
}

/// A short, stable key for a message shape. antd dedupes toasts by key, so two
/// reports of the same problem collapse even when React mounts the message
/// holder twice (StrictMode does exactly that in development).
function shapeKey(shape: string) {
  let h = 5381;
  for (let i = 0; i < shape.length; i++) h = ((h << 5) + h + shape.charCodeAt(i)) | 0;
  return `err:${(h >>> 0).toString(36)}`;
}

// A proxy rather than a plain object: `rawMessage` is only assigned once the
// bridge mounts, so every property has to be resolved at call time.
const message = new Proxy({} as MessageInstance, {
  get(_target, prop) {
    if (prop === "error") return errorOnce;
    const value = (rawMessage as unknown as Record<string | symbol, unknown>)?.[prop];
    return typeof value === "function" ? value.bind(rawMessage) : value;
  },
});

export default function AntdAppBridge() {
  const staticFunction = App.useApp();
  rawMessage = staticFunction.message;
  modal = staticFunction.modal;
  notification = staticFunction.notification;
  return null;
}

export { message, modal, notification };
