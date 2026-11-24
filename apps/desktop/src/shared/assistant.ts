import type { PineApprovalMode } from "./agent";
import type { PineModelSelection } from "./models";
import type { PineSessionSummary } from "./sessions";

/**
 * Pine's Assistant (internal name: orchestrator), the one conversation that
 * manages Pine instead of working in a project: it looks up, dispatches and
 * reports, and never does the work itself. See docs/orchestrator-proposal.md.
 */

/** User-facing name, kept in one place until the product name is settled. */
export const ASSISTANT_DISPLAY_NAME = {
  "en-US": "Assistant",
  "zh-CN": "助理",
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

/** The Assistant's settings, kept in its data folder as settings.json. */
export const ASSISTANT_SETTINGS_FILE = "settings.json" as const;

/**
 * The permission modes the Assistant may run in. Its mode is also the most
 * any session it dispatches may use, so YOLO is never one of them.
 */
export const ASSISTANT_APPROVAL_MODES = [
  "let-me-review",
  "auto-approve",
  "autonomous",
] as const satisfies readonly PineApprovalMode[];
export type AssistantApprovalMode = (typeof ASSISTANT_APPROVAL_MODES)[number];

export interface AssistantSettings {
  /** Absent: the Assistant follows the user's default model. */
  model?: PineModelSelection;
  /** The Assistant's own mode, and the most a dispatched session may use. */
  approvalMode: AssistantApprovalMode;
  /**
   * Whether a dispatched session's report starts an Assistant turn. Off: the
   * report waits in the conversation until the user next talks to it, so
   * dispatched work costs no Assistant tokens on its own (§3.8).
   */
  wakesOnReport: boolean;
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  approvalMode: ASSISTANT_APPROVAL_MODE,
  wakesOnReport: false,
};

/** What a window needs to open the Assistant. */
export interface AssistantState {
  /** Its one conversation, once the user or WeChat has started it. */
  session?: PineSessionSummary;
  settings: AssistantSettings;
}

export const GET_ASSISTANT_CHANNEL = "assistant:get" as const;
export const SET_ASSISTANT_SETTINGS_CHANNEL = "assistant:set-settings" as const;
/** Deletes the Assistant's conversation; the next message starts a new one. */
export const CLEAR_ASSISTANT_CHANNEL = "assistant:clear" as const;

export interface ClearAssistantResult {
  cleared: boolean;
}

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
    }
  | { op: "digest"; projectId: string; sessionId: string };

export type AssistantHostResult =
  | { op: "overview"; overview: AssistantOverview }
  | {
      op: "dispatch";
      sessionId: string;
      projectId: string;
      projectName: string;
      approvalMode: PineApprovalMode;
    }
  | { op: "digest"; digest: AssistantDigest };
