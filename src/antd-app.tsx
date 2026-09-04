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

let message: MessageInstance;
let notification: NotificationInstance;
let modal: Omit<ModalStaticFunctions, "warn">;

export default function AntdAppBridge() {
  const staticFunction = App.useApp();
  message = staticFunction.message;
  modal = staticFunction.modal;
  notification = staticFunction.notification;
  return null;
}

export { message, modal, notification };
