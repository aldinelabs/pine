import { BrowserWindow, ipcMain, Notification } from "electron";
import { z } from "zod";
import {
  CANCEL_WECHAT_BINDING_CHANNEL,
  DEFAULT_WECHAT_STATUS,
  GET_WECHAT_REMOTE_CHANNEL,
  SET_WECHAT_PAUSED_CHANNEL,
  SET_WECHAT_SETTINGS_CHANNEL,
  START_WECHAT_BINDING_CHANNEL,
  SUBMIT_WECHAT_PAIRING_CODE_CHANNEL,
  SUBMIT_WECHAT_VERIFY_CODE_CHANNEL,
  UNBIND_WECHAT_CHANNEL,
  WECHAT_REMOTE_CHANGED_CHANNEL,
  type WeChatNotification,
  type WeChatSettingsPatch,
  type WeChatStatus,
} from "../../shared/wechatRemote";
import type { PineCore } from "../core/pineCore";

const approvalMode = z.enum([
  "let-me-review",
  "auto-approve",
  "autonomous",
  "YOLO",
]);

/** Full-width digits typed on some keyboards count as the digits they show. */
function normalizedCode(value: string): string {
  return value.normalize("NFKC").trim();
}

export const wechatPausedSchema = z.boolean();

export const wechatVerifyCodeSchema = z
  .string()
  .max(256)
  .transform(normalizedCode)
  .pipe(z.string().min(1).max(32));

export const wechatPairingCodeSchema = z
  .string()
  .max(256)
  .transform(normalizedCode)
  .pipe(z.string().regex(/^\d{6}$/));

export const wechatSettingsPatchSchema: z.ZodType<WeChatSettingsPatch> = z
  .object({
    ceilingMode: approvalMode.optional(),
    defaultMode: approvalMode.optional(),
    defaultProjectId: z.uuid().nullable().optional(),
    allowHighRiskApprovals: z.boolean().optional(),
    allowFileSending: z.boolean().optional(),
  })
  .strict();

function requireBridge(core: () => PineCore | null): PineCore["wechat"] {
  const pine = core();
  if (!pine) throw new Error("WeChat remote is not ready.");
  return pine.wechat;
}

/**
 * The settings page's WeChat requests. Registered on `ipcMain` itself, never on
 * the shared router, so neither the browser interface nor a paired phone can
 * reach them, whatever the web request policy lists.
 */
export function registerWeChatIpc(core: () => PineCore | null): void {
  ipcMain.handle(
    GET_WECHAT_REMOTE_CHANNEL,
    (): WeChatStatus => core()?.wechat.status() ?? DEFAULT_WECHAT_STATUS,
  );
  ipcMain.handle(SET_WECHAT_PAUSED_CHANNEL, (_event, request: unknown) => {
    const paused = wechatPausedSchema.parse(request);
    return requireBridge(core).setPaused(paused);
  });
  ipcMain.handle(START_WECHAT_BINDING_CHANNEL, () =>
    requireBridge(core).startBinding(),
  );
  ipcMain.handle(CANCEL_WECHAT_BINDING_CHANNEL, () =>
    Promise.resolve(requireBridge(core).cancelBinding()),
  );
  ipcMain.handle(
    SUBMIT_WECHAT_VERIFY_CODE_CHANNEL,
    (_event, request: unknown) => {
      const code = wechatVerifyCodeSchema.parse(request);
      return Promise.resolve(requireBridge(core).submitVerifyCode(code));
    },
  );
  ipcMain.handle(
    SUBMIT_WECHAT_PAIRING_CODE_CHANNEL,
    (_event, request: unknown) => {
      const code = wechatPairingCodeSchema.parse(request);
      return requireBridge(core).submitPairingCode(code);
    },
  );
  ipcMain.handle(UNBIND_WECHAT_CHANNEL, () => requireBridge(core).unbind());
  ipcMain.handle(SET_WECHAT_SETTINGS_CHANNEL, (_event, request: unknown) => {
    const patch = wechatSettingsPatchSchema.parse(request);
    return requireBridge(core).setSettings(patch);
  });
}

/** Tells every window's settings page what changed. */
export function broadcastWeChatStatus(status: WeChatStatus): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(WECHAT_REMOTE_CHANGED_CHANNEL, status);
}

/** Where a notification about a project or session leads when clicked. */
export interface WeChatNotificationTarget {
  projectId?: string;
  sessionId?: string;
}

const shown = new Set<Notification>();

/**
 * Shows what WeChat remote did or needs. These are security signals, so the
 * attention-notifications setting does not silence them. Clicking brings the
 * window `window` picks for the notification's project and session forward.
 */
export function showWeChatNotification(
  notification: WeChatNotification,
  window: (target: WeChatNotificationTarget) => BrowserWindow | undefined,
): void {
  if (!Notification.isSupported()) return;
  const native = new Notification({
    title: notification.title,
    body: notification.body,
  });
  shown.add(native);
  const release = () => shown.delete(native);
  native.on("click", () => {
    release();
    const target = window({
      ...(notification.projectId ? { projectId: notification.projectId } : {}),
      ...(notification.sessionId ? { sessionId: notification.sessionId } : {}),
    });
    if (!target || target.isDestroyed()) return;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
  });
  native.on("close", release);
  native.on("failed", release);
  native.show();
}
