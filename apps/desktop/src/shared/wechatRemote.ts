import { APPROVAL_MODE_ORDER, type PineApprovalMode } from "./agent";

/** The WeChat bridge's place among the clients that hold project runtimes. */
export const WECHAT_CLIENT_ID = -2;

/**
 * Told to the agent in a session used from WeChat, where the user may be
 * away from the computer and cannot see Pine's previews.
 */
export const WECHAT_SESSION_NOTICE = [
  "This session is also used from WeChat through Pine's remote control. The user may be reading on their phone, away from this computer, and cannot see Pine's preview panel or anything opened on screen.",
  "- When the user asks you to send, share or show them a file, submit it with ui_submit_artifact; presenting it alone does not reach them. Pine delivers submitted files to WeChat: right after your reply when file sending is turned on in Pine's WeChat settings, otherwise the user fetches them with `.o`.",
  "- Do not claim a file was sent or opened for them; say it was submitted and how to get it.",
].join("\n");

export const GET_WECHAT_REMOTE_CHANNEL = "wechat:get";
export const SET_WECHAT_PAUSED_CHANNEL = "wechat:set-paused";
export const START_WECHAT_BINDING_CHANNEL = "wechat:start-binding";
export const CANCEL_WECHAT_BINDING_CHANNEL = "wechat:cancel-binding";
export const SUBMIT_WECHAT_VERIFY_CODE_CHANNEL = "wechat:submit-verify-code";
export const SUBMIT_WECHAT_PAIRING_CODE_CHANNEL = "wechat:submit-pairing-code";
export const UNBIND_WECHAT_CHANNEL = "wechat:unbind";
export const SET_WECHAT_SETTINGS_CHANNEL = "wechat:set-settings";
export const WECHAT_REMOTE_CHANGED_CHANNEL = "wechat:changed";

/** Requests the settings page sends; the desktop app answers them over IPC only. */
export const WECHAT_REQUEST_CHANNELS = [
  GET_WECHAT_REMOTE_CHANNEL,
  SET_WECHAT_PAUSED_CHANNEL,
  START_WECHAT_BINDING_CHANNEL,
  CANCEL_WECHAT_BINDING_CHANNEL,
  SUBMIT_WECHAT_VERIFY_CODE_CHANNEL,
  SUBMIT_WECHAT_PAIRING_CODE_CHANNEL,
  UNBIND_WECHAT_CHANNEL,
  SET_WECHAT_SETTINGS_CHANNEL,
] as const;

/** What the bound WeChat account may do on this computer. */
export interface WeChatSettings {
  /** The least supervised approval mode a session driven from WeChat may use. */
  ceilingMode: PineApprovalMode;
  /** The mode of sessions started from WeChat; never above the ceiling. */
  defaultMode: PineApprovalMode;
  /** Where `.new` starts a session; absent means the temporary workspace. */
  defaultProjectId?: string;
  /** Lets WeChat approve privileged and destructive-pattern requests. */
  allowHighRiskApprovals: boolean;
  /** Lets WeChat receive files the agent presented. */
  allowFileSending: boolean;
}

/** `defaultProjectId: null` clears the field (back to "No Project"); `undefined` leaves it. */
export type WeChatSettingsPatch = Partial<
  Omit<WeChatSettings, "defaultProjectId">
> & { defaultProjectId?: string | null };

export const DEFAULT_WECHAT_SETTINGS: WeChatSettings = {
  ceilingMode: "auto-approve",
  defaultMode: "auto-approve",
  allowHighRiskApprovals: false,
  allowFileSending: false,
};

function modeRank(mode: PineApprovalMode): number {
  return APPROVAL_MODE_ORDER.indexOf(mode);
}

/** Lowers defaultMode to the ceiling when it is above it. */
export function clampWeChatSettings(settings: WeChatSettings): WeChatSettings {
  if (modeRank(settings.defaultMode) <= modeRank(settings.ceilingMode)) {
    return { ...settings };
  }
  return { ...settings, defaultMode: settings.ceilingMode };
}

/** Applies a patch from the settings page, then clamps. */
export function applyWeChatSettingsPatch(
  settings: WeChatSettings,
  patch: WeChatSettingsPatch,
): WeChatSettings {
  const next: WeChatSettings = { ...settings };
  if (patch.ceilingMode !== undefined) next.ceilingMode = patch.ceilingMode;
  if (patch.defaultMode !== undefined) next.defaultMode = patch.defaultMode;
  if (patch.allowHighRiskApprovals !== undefined) {
    next.allowHighRiskApprovals = patch.allowHighRiskApprovals;
  }
  if (patch.allowFileSending !== undefined) {
    next.allowFileSending = patch.allowFileSending;
  }
  if (patch.defaultProjectId === null) {
    delete next.defaultProjectId;
  } else if (patch.defaultProjectId !== undefined) {
    next.defaultProjectId = patch.defaultProjectId;
  }
  return clampWeChatSettings(next);
}

/** The values that widen what WeChat may do; reset on unbind and on a bind by a new account. */
export function resetWeChatPermissions(
  settings: WeChatSettings,
): WeChatSettings {
  return clampWeChatSettings({
    ...settings,
    ceilingMode: DEFAULT_WECHAT_SETTINGS.ceilingMode,
    defaultMode: DEFAULT_WECHAT_SETTINGS.defaultMode,
    allowHighRiskApprovals: DEFAULT_WECHAT_SETTINGS.allowHighRiskApprovals,
    allowFileSending: DEFAULT_WECHAT_SETTINGS.allowFileSending,
  });
}

export type WeChatConnection =
  "unbound" | "connecting" | "online" | "retrying" | "reauth-required";

export type WeChatBindingPhase =
  "starting" | "qr" | "scanned" | "verify-code" | "confirming" | "pairing";

/** Progress of linking a WeChat account, shown in the binding dialog. */
export interface WeChatBinding {
  phase: WeChatBindingPhase;
  qrContent?: string;
  expiresAt?: number;
  /** The verification code typed last time was wrong. */
  verifyRetry?: boolean;
  /** Phase "pairing": the code was sent to WeChat and is awaited here. */
  pairing?: { codeSent: boolean; attemptsLeft: number; expiresAt: number };
}

export type WeChatErrorCode =
  | "encryption-unavailable"
  | "binding-expired"
  | "binding-blocked"
  | "pairing-failed"
  | "binding-failed"
  | "account-mismatch"
  | "network"
  | "settings-reset";

/** What the settings page shows about WeChat remote. */
export interface WeChatStatus {
  bound: boolean;
  paused: boolean;
  connection: WeChatConnection;
  /** `userDigest` looks like "A1B2-C3D4"; the raw account id never leaves the main process. */
  owner?: { userDigest: string; boundAt: number };
  binding?: WeChatBinding;
  settings: WeChatSettings;
  error?: WeChatErrorCode;
}

export const DEFAULT_WECHAT_STATUS: WeChatStatus = {
  bound: false,
  paused: false,
  connection: "unbound",
  settings: { ...DEFAULT_WECHAT_SETTINGS },
};

/** Events that always produce a local notification, whatever the attention setting. */
export const WECHAT_NOTIFICATION_KINDS = [
  "session-started",
  "session-used",
  "reauth-required",
  "paused",
  "file-sent",
  "session-deleted",
  "automation-run",
  "mode-raised",
  "high-risk-approved",
  "settings-reset",
] as const;

export type WeChatNotificationKind = (typeof WECHAT_NOTIFICATION_KINDS)[number];

export interface WeChatNotification {
  kind: WeChatNotificationKind;
  title: string;
  body: string;
  projectId?: string;
  sessionId?: string;
}

/** Desktop app only; absent in the browser interface. */
export interface PineWeChatApi {
  getWeChatRemote?: () => Promise<WeChatStatus>;
  setWeChatPaused?: (paused: boolean) => Promise<WeChatStatus>;
  startWeChatBinding?: () => Promise<WeChatStatus>;
  cancelWeChatBinding?: () => Promise<WeChatStatus>;
  submitWeChatVerifyCode?: (code: string) => Promise<WeChatStatus>;
  submitWeChatPairingCode?: (code: string) => Promise<WeChatStatus>;
  unbindWeChat?: () => Promise<WeChatStatus>;
  setWeChatSettings?: (patch: WeChatSettingsPatch) => Promise<WeChatStatus>;
  onWeChatRemoteChanged?: (
    listener: (status: WeChatStatus) => void,
  ) => () => void;
}
