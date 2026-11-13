// Local notifications raised by WeChat remote. They are always
// shown, whatever the attention-notification setting, because each one tells
// the person at the computer that WeChat did something here.

import type { PineApprovalMode } from "../../shared/agent";
import type { WeChatNotificationKind } from "../../shared/wechatRemote";
import { modeLabel } from "./replies";
import { baseName, cleanInline, formatSize, truncate } from "./text";
import type { ReplyLanguage } from "./types";

/** Longest notification body, in code points. */
export const NOTICE_BODY_MAX = 120;
/** Longest approval subject quoted in a notification. */
export const NOTICE_SUBJECT_MAX = 60;
const NOTICE_TITLE_MAX = 60;
const NAME_MAX = 30;

export interface NoticeData {
  "session-started": { project: string; title: string; text?: string };
  "session-used": { project: string; title: string };
  "reauth-required": Record<never, never>;
  paused: { running?: number };
  "file-sent": { name: string; sizeBytes?: number; title?: string };
  "session-deleted": { project: string; title: string };
  "automation-run": { name: string; project?: string };
  "mode-raised": { project: string; title: string; mode: PineApprovalMode };
  "high-risk-approved": {
    project: string;
    title: string;
    tool: string;
    subject?: string;
  };
  "settings-reset": Record<never, never>;
}

type NoticeArgs<K extends WeChatNotificationKind> =
  Record<never, never> extends NoticeData[K]
    ? [data?: NoticeData[K]]
    : [data: NoticeData[K]];

type L = ReplyLanguage;

function name(text: string): string {
  return truncate(cleanInline(text), NAME_MAX) || "…";
}

function session(data: { project: string; title: string }): string {
  return `${name(data.project)} › ${name(data.title)}`;
}

type Texts = { title: string; body: string };

const NOTICES: {
  [K in WeChatNotificationKind]: (lang: L, data: NoticeData[K]) => Texts;
} = {
  "session-started": (lang, data) => {
    const text = data.text ? cleanInline(data.text) : "";
    return lang === "zh"
      ? {
          title: "微信发起了新会话",
          body: text ? `${session(data)}：${text}` : session(data),
        }
      : {
          title: "Session started from WeChat",
          body: text ? `${session(data)}: ${text}` : session(data),
        };
  },
  "session-used": (lang, data) =>
    lang === "zh"
      ? { title: "微信正在使用这个会话", body: session(data) }
      : { title: "Session used from WeChat", body: session(data) },
  "reauth-required": (lang) =>
    lang === "zh"
      ? {
          title: "微信需要重新扫码",
          body: "微信远程已断开，收不到微信消息。请在 设置 › 远程控制 中重新扫码。",
        }
      : {
          title: "WeChat needs a new scan",
          body: "WeChat remote was disconnected and receives no messages. Scan again in Settings › Remote control.",
        },
  paused: (lang, data) => {
    const running = data.running ?? 0;
    return lang === "zh"
      ? {
          title: "微信远程已暂停",
          body: `已从微信暂停，可在 设置 › 远程控制 中恢复。${running > 0 ? `仍有 ${running} 个会话在运行。` : ""}`,
        }
      : {
          title: "WeChat remote paused",
          body: `Paused from WeChat. Resume it in Settings › Remote control.${running > 0 ? ` ${running} session(s) still running.` : ""}`,
        };
  },
  "file-sent": (lang, data) => {
    const file = truncate(cleanInline(baseName(data.name)), 50);
    const size = data.sizeBytes === undefined ? "" : formatSize(data.sizeBytes);
    if (lang === "zh")
      return {
        title: "已向微信发送文件",
        body: `${file}${size ? `（${size}）` : ""}${data.title ? `，来自「${name(data.title)}」` : ""}`,
      };
    return {
      title: "File sent to WeChat",
      body: `${file}${size ? ` (${size})` : ""}${data.title ? `, from "${name(data.title)}"` : ""}`,
    };
  },
  "session-deleted": (lang, data) =>
    lang === "zh"
      ? { title: "微信删除了一个会话", body: session(data) }
      : { title: "Session deleted from WeChat", body: session(data) },
  "automation-run": (lang, data) => {
    const where = data.project ? name(data.project) : undefined;
    return lang === "zh"
      ? {
          title: "微信运行了自动化",
          body: `「${name(data.name)}」${where ? `（${where}）` : ""}已开始运行。`,
        }
      : {
          title: "Automation run from WeChat",
          body: `"${name(data.name)}"${where ? ` (${where})` : ""} has started.`,
        };
  },
  "mode-raised": (lang, data) =>
    lang === "zh"
      ? {
          title: "微信提高了审批模式",
          body: `${session(data)}：${modeLabel(lang, data.mode)}`,
        }
      : {
          title: "Approval mode raised from WeChat",
          body: `${session(data)}: ${modeLabel(lang, data.mode)}`,
        },
  "high-risk-approved": (lang, data) => {
    const tool = truncate(cleanInline(data.tool), 30);
    const subject = data.subject
      ? truncate(cleanInline(data.subject), NOTICE_SUBJECT_MAX)
      : "";
    const what = subject ? `${tool} ${subject}` : tool;
    return lang === "zh"
      ? {
          title: "已从微信批准高风险操作",
          body: `${session(data)}：${what}`,
        }
      : {
          title: "High-risk action approved from WeChat",
          body: `${session(data)}: ${what}`,
        };
  },
  "settings-reset": (lang) =>
    lang === "zh"
      ? {
          title: "微信远程设置已重置",
          body: "无法读取微信远程设置，已恢复默认并暂停。请在 设置 › 远程控制 中检查。",
        }
      : {
          title: "WeChat settings were reset",
          body: "WeChat settings could not be read and were reset. WeChat remote is paused.",
        },
};

/**
 * Title and body of a local notification. The body is at most
 * NOTICE_BODY_MAX code points; an approval subject is cut to
 * NOTICE_SUBJECT_MAX. Never contains a path, a token or a code.
 */
export function notice<K extends WeChatNotificationKind>(
  kind: K,
  lang: L,
  ...data: NoticeArgs<K>
): Texts {
  const build = NOTICES[kind] as (lang: L, data: NoticeData[K]) => Texts;
  const texts = build(lang, (data[0] ?? {}) as NoticeData[K]);
  return {
    title: truncate(texts.title, NOTICE_TITLE_MAX),
    body: truncate(texts.body, NOTICE_BODY_MAX),
  };
}
