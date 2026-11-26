import type { PineApprovalMode } from "./agent";
import type { PineSessionSummary } from "./sessions";

/**
 * Pine's Assistant (internal name: orchestrator), the one conversation that
 * manages Pine instead of working in a project: it looks up, dispatches and
 * reports, and never does the work itself. See docs/orchestrator-proposal.md.
 */

/** User-facing name, kept in one place until the product name is settled. */
export const ASSISTANT_DISPLAY_NAME = {
  "en-US": "Orchestrator",
  "zh-CN": "指挥",
} as const;

/**
 * Product decisions still open (docs/orchestrator-proposal.md §5), kept
 * together so a later answer changes one place. One Assistant per Pine
 * user, no web search for it and the user's default model are not settings:
 * they follow from how the Assistant is built.
 */
export const ASSISTANT_DECISIONS = {
  /** Where plain WeChat text goes for someone who connects WeChat now. */
  wechatPlainTargetForNewSetups: "assistant",
  /** …and for someone whose WeChat remote was set up before the Assistant. */
  wechatPlainTargetForExistingSetups: "session",
} as const;

/**
 * The Assistant lives in a hidden built-in project with fixed ids, so it
 * reuses project runtimes and session storage. Its data sits in the data
 * directory's `assistant/` folder, beside `projects/`, so project listings
 * never see it.
 */
export const ASSISTANT_PROJECT_ID =
  "00000000-0000-4000-8000-000000000003" as const;
export const ASSISTANT_FOLDER_ID =
  "00000000-0000-4000-8000-000000000004" as const;
/** The Assistant's root inside Pine's data directory. */
export const ASSISTANT_DIRECTORY = "assistant" as const;
/** Its working directory inside that root: always empty, shared with no one. */
export const ASSISTANT_WORKSPACE_DIRECTORY = "workspace" as const;
/** Which sessions the Assistant dispatched, and where each one runs. */
export const ASSISTANT_DISPATCHES_FILE = "dispatches.json" as const;
/** The Assistant's one conversation. */
export const ASSISTANT_STATE_FILE = "state.json" as const;

/** The virtual client that holds the Assistant's runtime; see isVirtualClient. */
export const ASSISTANT_CLIENT_ID = -3;

/** By default the Assistant runs supervised by an AI reviewer. */
export const ASSISTANT_APPROVAL_MODE =
  "auto-approve" satisfies PineApprovalMode;

export function isAssistantProject(projectId: string | undefined): boolean {
  return projectId === ASSISTANT_PROJECT_ID;
}

/** Where an Assistant turn came from: dispatches of a WeChat turn stay within WeChat's limits. */
export type AssistantTurnSource = "wechat" | "desktop";

export const PINE_OVERVIEW_TOOL_NAME = "pine_overview" as const;
export const DISPATCH_TASK_TOOL_NAME = "dispatch_task" as const;
export const SESSION_DIGEST_TOOL_NAME = "session_digest" as const;
export const WATCH_TOOL_NAME = "watch" as const;
export const WATCH_LIST_TOOL_NAME = "watch_list" as const;
export const WATCH_CANCEL_TOOL_NAME = "watch_cancel" as const;
export const APPROVALS_LIST_TOOL_NAME = "approvals_list" as const;
export const SETTINGS_READ_TOOL_NAME = "settings_read" as const;

/** The Assistant's reminders, watches and briefings. */
export const ASSISTANT_WATCHES_FILE = "watches.json" as const;
/** Watches kept at once; more are refused. */
export const ASSISTANT_WATCHES_MAX = 30;

/**
 * Whether a dispatched session's report starts an Assistant turn. No: the
 * report waits in the conversation until the user next talks to it, so
 * dispatched work costs no Assistant tokens on its own (§3.8). Results still
 * reach the user as each session's own completion signal and WeChat push.
 */
export const ASSISTANT_WAKES_ON_REPORT = false;

/**
 * In US dollars: a dispatched session, or the Assistant's own conversation,
 * that costs more than this is pointed out in its next report, again at each
 * further multiple. Only a reminder, never a limit.
 */
export const ASSISTANT_COST_REMINDER_USD = 5;

/** What a window needs to open the Assistant. */
export interface AssistantState {
  /** Its one conversation, once the user or WeChat has started it. */
  session?: PineSessionSummary;
}

export const GET_ASSISTANT_CHANNEL = "assistant:get" as const;

/**
 * The first line Pine puts on a user message that came in through WeChat.
 * One thread holds both WeChat and desktop messages and the system prompt is
 * fixed, so the source travels with each message and the prompt's "Talking
 * to the user" rules pick the style by it. Unmarked messages are from Pine on
 * the computer. The desktop strips it and shows "From WeChat" instead.
 */
export const ASSISTANT_WECHAT_MARK = "[WeChat]";

/** The text to send the Assistant for what the user wrote in WeChat. */
export function markWeChatMessage(text: string): string {
  return `${ASSISTANT_WECHAT_MARK}\n${text}`;
}

/** What the user wrote, without the WeChat mark, and whether it had one. */
export function readAssistantMessage(text: string): {
  text: string;
  fromWeChat: boolean;
} {
  const prefix = `${ASSISTANT_WECHAT_MARK}\n`;
  return text.startsWith(prefix)
    ? { text: text.slice(prefix.length), fromWeChat: true }
    : { text, fromWeChat: false };
}

/** Attachments dispatch_task may forward at once. */
export const ASSISTANT_DISPATCH_ATTACHMENTS_MAX = 20;

/**
 * The id the Assistant names an attachment of its conversation by. It hashes
 * the attachment's path, so it stays the same however often the message is
 * shown to the model or the conversation is compacted, and needs no store.
 */
export function assistantAttachmentId(attachment: { path: string }): string {
  // Two FNV-1a 32-bit hashes with different offsets: 64 bits, no crypto,
  // so the renderer, main and agent compute the same id.
  let first = 0x811c9dc5;
  let second = 0x01000193 ^ 0x9e3779b9;
  for (let index = 0; index < attachment.path.length; index += 1) {
    const code = attachment.path.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x01000193) >>> 0;
  }
  return `att_${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/** What a session is doing now, as the Assistant reports it. */
export type AssistantSessionState = "running" | "awaiting-approval" | "idle";

export interface AssistantOverviewSession {
  id: string;
  projectId: string;
  projectName: string;
  title?: string;
  state: AssistantSessionState;
  updatedAt?: string;
  /** The Assistant dispatched it. */
  dispatched?: true;
}

export interface AssistantOverview {
  projects: { id: string; name: string; temporaryWorkspace?: true }[];
  /** Sessions running or waiting for approval, in every project. */
  active: AssistantOverviewSession[];
  /** Sessions the Assistant dispatched, most recent first. */
  dispatched: AssistantOverviewSession[];
  /** Approvals and questions waiting for the user, across Pine. */
  pendingApprovals: number;
}

export interface AssistantDigest {
  session: AssistantOverviewSession;
  messageCount: number;
  /** The start of its last reply. */
  lastReply?: string;
  /** The user's or dispatcher's last message to it. */
  lastRequest?: string;
}

/**
 * When a watch wakes the Assistant: once at an instant, on an automation-style
 * schedule (an RRULE in a time zone), or when a session ends its turn.
 */
export type AssistantWatchTrigger =
  | { kind: "at"; at: string }
  | { kind: "schedule"; rrule: string; timezone: string }
  | { kind: "session"; projectId: string; sessionId: string };

/**
 * A reminder, watch or briefing the user asked for. It only wakes the
 * Assistant, which then reports; it never does any work itself.
 */
export interface AssistantWatch {
  id: string;
  /** What the user asked to be told, in their words. */
  label: string;
  trigger: AssistantWatchTrigger;
  /** Where the user asked, so the Assistant answers there. */
  source: AssistantTurnSource;
  createdAt: string;
  /** The next time it wakes the Assistant, for `at` and `schedule`. */
  nextAt?: string;
  lastFiredAt?: string;
  /** The watched session's title and project, for `session`. */
  sessionTitle?: string;
  projectName?: string;
}

/** An approval card or question waiting for the user, as the Assistant lists it. */
export interface AssistantPendingApproval {
  kind: "approval" | "question" | "automation";
  projectId: string;
  projectName: string;
  sessionId?: string;
  sessionTitle?: string;
  /** The tool or request it is about, such as bash or "enable automation". */
  what: string;
  /** Pine's one-line subject of the card, when it has one. */
  subject?: string;
  since: string;
  /** Its number in WeChat, when WeChat shows it as a card. */
  wechatCard?: number;
  /** Only the computer can decide it. */
  localOnly?: true;
}

/** A setting the Assistant may read, never change. */
export interface AssistantSettingFact {
  /** Where the user finds it, such as "Settings › General › Language". */
  where: string;
  value: string;
}

export interface AssistantAutomationFact {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string;
  status: "active" | "paused" | "off";
  triggers: string[];
  nextRunAt?: string;
  lastRun?: { status: string; at: string };
  running: boolean;
}

export interface AssistantAutomationDetail extends AssistantAutomationFact {
  /** Folders it reads and writes, and hosts it reaches. */
  reads: string[];
  writes: string[];
  network: string[];
  /** Why it cannot run now, if it cannot: the WeChat `.auto N run` rules. */
  runRefusal?: string;
}

export interface AssistantSessionFact {
  sessionId: string;
  projectId: string;
  projectName: string;
  title?: string;
  state: AssistantSessionState;
  /** The Assistant dispatched it, so it may act on it without asking. */
  dispatched: boolean;
}

/** What the Assistant's tools ask of the main process. */
export type AssistantHostOperation =
  | { op: "overview" }
  | {
      op: "dispatch";
      projectId: string;
      title?: string;
      message: string;
      approvalMode: PineApprovalMode;
      locale: "en-US" | "zh-CN";
      /** Attachments of the Assistant's conversation, by assistantAttachmentId. */
      attachmentIds?: string[];
    }
  | { op: "digest"; projectId: string; sessionId: string }
  | {
      op: "watch-create";
      label: string;
      trigger:
        | { kind: "at"; at: string }
        | { kind: "schedule"; rrule: string; timezone?: string }
        | { kind: "session"; projectId: string; sessionId: string };
    }
  | { op: "watch-list" }
  | { op: "watch-cancel"; watchId: string }
  | { op: "approvals" }
  | { op: "settings" }
  | { op: "projects" }
  | { op: "automations"; projectId?: string }
  | { op: "automation"; projectId: string; automationId: string }
  | { op: "automation-disable"; projectId: string; automationId: string }
  | { op: "automation-run"; projectId: string; automationId: string }
  | { op: "session"; projectId: string; sessionId: string }
  | {
      op: "session-send";
      projectId: string;
      sessionId: string;
      message: string;
      locale: "en-US" | "zh-CN";
      /** The user confirmed acting on a session the Assistant did not dispatch. */
      confirmed: boolean;
    }
  | {
      op: "session-stop";
      projectId: string;
      sessionId: string;
      confirmed: boolean;
    }
  | {
      op: "session-rename";
      projectId: string;
      sessionId: string;
      title: string;
      confirmed: boolean;
    };

export interface AssistantProjectFact {
  id: string;
  name: string;
  folders: { path: string; readOnly: boolean }[];
  temporaryWorkspace?: true;
}

export type AssistantHostResult =
  | { op: "overview"; overview: AssistantOverview }
  | {
      op: "dispatch";
      sessionId: string;
      projectId: string;
      projectName: string;
      approvalMode: PineApprovalMode;
      /** How many attachments went with its first message. */
      attachments?: number;
    }
  | { op: "digest"; digest: AssistantDigest }
  | { op: "watch-create"; watch: AssistantWatch }
  | { op: "watch-list"; watches: AssistantWatch[] }
  | { op: "watch-cancel"; cancelled: boolean; label?: string }
  | { op: "approvals"; approvals: AssistantPendingApproval[] }
  | { op: "settings"; settings: AssistantSettingFact[] }
  | { op: "projects"; projects: AssistantProjectFact[] }
  | { op: "automations"; automations: AssistantAutomationFact[] }
  | { op: "automation"; automation: AssistantAutomationDetail }
  | { op: "automation-disable"; name: string; changed: boolean }
  | { op: "automation-run"; name: string }
  | { op: "session"; session: AssistantSessionFact }
  | { op: "session-send"; delivered: "steer" | "turn" }
  | { op: "session-stop"; stopped: boolean }
  | { op: "session-rename"; title: string };
