import type { AutomationHostOperation } from "./automation";
import type { ProjectHostOperation } from "./projects";
import type {
  PineApprovalExplanation,
  PineApprovalReasonCode,
  PineApprovalReview,
  PineSessionSummary,
  SessionHostOperation,
} from "./sessions";
import type { PineSessionMutator } from "./sessionMutators";
import type { McpHostOperation } from "./mcp";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import type {
  FilePresentationDisplay,
  FilePreviewTarget,
  FileReveal,
} from "./projectFiles";
import type { WorkbenchCommand } from "./workbench";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";

/**
 * Lets the agent open a file for the user to read. The main process resolves
 * the path into a tab target before the renderer sees it, so the request never
 * carries a raw path across the boundary.
 */
export const UI_PRESENT_FILE_TOOL_NAME = "ui_present_file" as const;
/**
 * Registers files as the session's artifacts (its deliverables). Unlike
 * presenting, it opens nothing; the Artifacts panel lists what it recorded.
 */
export const UI_SUBMIT_ARTIFACT_TOOL_NAME = "ui_submit_artifact" as const;
export const UI_PROJECT_LIST_TOOL_NAME = "ui_project_list" as const;
export const UI_LIST_MODELS_TOOL_NAME = "ui_list_models" as const;
export const UI_SESSION_TELEPORT_TOOL_NAME = "ui_session_teleport" as const;
/** Searches the user's sessions; a bare `*` lists the most recent ones. */
export const UI_SESSION_SEARCH_TOOL_NAME = "ui_session_search" as const;
/** Starts another session in the background with a first message. */
export const UI_SESSION_NEW_TOOL_NAME = "ui_session_new" as const;
/** Shows a project's session folders and the sessions in them. */
export const UI_SESSION_TREE_TOOL_NAME = "ui_session_tree" as const;
/** Edits session folders and titles, checked against the tree's revision. */
export const UI_SESSION_ORGANIZE_TOOL_NAME = "ui_session_organize" as const;
/** Retitles the asking session to what it is working on now. */
export const UI_SESSION_RENAME_TOOL_NAME = "ui_session_rename" as const;
/** Lists the asking session's parent, sub-sessions and siblings. */
export const UI_SESSION_RELATIVES_TOOL_NAME = "ui_session_relatives" as const;
/** Reads a related session's messages. */
export const UI_SESSION_READ_TOOL_NAME = "ui_session_read" as const;
/** Sends a message to a related session. */
export const UI_SESSION_SEND_TOOL_NAME = "ui_session_send" as const;
/** Deletes a session permanently; the user approves every call. */
export const UI_SESSION_DELETE_TOOL_NAME = "ui_session_delete" as const;
/** Project management; the user approves every call, in every mode. */
export const UI_PROJECT_CREATE_TOOL_NAME = "ui_project_create" as const;
export const UI_PROJECT_UPDATE_TOOL_NAME = "ui_project_update" as const;
export const UI_PROJECT_DELETE_TOOL_NAME = "ui_project_delete" as const;
/** Shows the user an interim answer as reply text while the agent keeps working. */
export const REPORT_PROGRESS_TOOL_NAME = "report_progress" as const;

/**
 * Names Pine's own tools had before they were renamed.
 * Transcripts keep the name a call was made with; readers map it here.
 */
const LEGACY_TOOL_NAMES: Readonly<Record<string, string>> = {
  ui_list_project: UI_PROJECT_LIST_TOOL_NAME,
  ui_teleport: UI_SESSION_TELEPORT_TOOL_NAME,
  ui_report_progress: REPORT_PROGRESS_TOOL_NAME,
};

/** The current name of a tool that a transcript may record under an old one. */
export function currentToolName(name: string): string {
  return LEGACY_TOOL_NAMES[name] ?? name;
}
/** Current time and timestamp conversion; models cannot read a clock. */
export const DATETIME_TOOL_NAME = "datetime" as const;
/** Loads the reference of Pine's own UI; later it enables the tools that operate it. */
export const ACTIVATE_PINE_OPS_TOOL_NAME = "activate_pine_ops" as const;
/**
 * pi-vcc's session history search, available on the semantic compaction route.
 * vite.agent.config.ts renames pi-vcc's `vcc_recall` to this at build time.
 */
export const RECALL_TOOL_NAME = "recall" as const;

export const PROMPT_SESSION_CHANNEL = "sessions:prompt" as const;
export const ABORT_SESSION_CHANNEL = "sessions:abort" as const;
export const COMPACT_SESSION_CHANNEL = "sessions:compact" as const;
export const DEQUEUE_STEERING_CHANNEL = "sessions:dequeue-steering" as const;
export const SEND_STEERING_NOW_CHANNEL = "sessions:send-steering-now" as const;
export const SET_APPROVAL_MODE_CHANNEL = "sessions:set-approval-mode" as const;
export const SESSION_EVENT_CHANNEL = "sessions:event" as const;

/**
 * How strictly Pine gates the agent's tool calls.
 *
 * - `let-me-review`: ask the user to review operations that need approval.
 * - `auto-approve`: let AI assess and approve operations automatically.
 * - `autonomous`: let AI review escalations without asking the user.
 * - `YOLO`: disable every Pine sandbox, folder restriction, and approval
 *   gate; expose privileged bash instead of ordinary bash.
 */
export type PineApprovalMode =
  "let-me-review" | "auto-approve" | "autonomous" | "YOLO";

/** Approval modes from the most to the least supervised. */
export const APPROVAL_MODE_ORDER: readonly PineApprovalMode[] = [
  "let-me-review",
  "auto-approve",
  "autonomous",
  "YOLO",
];

/**
 * Whether a session in `current` may start one in `requested`: never with
 * less supervision than its own, so a new session cannot widen what the
 * agent may do without approval.
 */
export function approvalModeWithin(
  requested: PineApprovalMode,
  current: PineApprovalMode,
): boolean {
  return (
    APPROVAL_MODE_ORDER.indexOf(requested) <=
    APPROVAL_MODE_ORDER.indexOf(current)
  );
}

/** Why a tool call needed an approval decision before it could proceed. */
export type PineApprovalTrigger =
  | "pre-execution"
  | "sandbox-denied"
  | "authorize-denied"
  | "destructive-pattern"
  | "privileged-execution"
  /** Activating tools would rewrite a long, cached context; the user may compress first. */
  | "long-context-activation";

/** A failed automatic review that fell back to manual approval. */
export interface PineAutoApprovalFailure {
  /** Shared by requests from the same failed review batch. */
  id: string;
  message: string;
}

export type PineApprovalAction =
  | "approve"
  | "reject"
  | "guide"
  /** Long-context activation card: compress the conversation, then continue. */
  | "compact"
  /** Long-context activation card: stop the run without activating. */
  | "abort";

export interface RespondApprovalRequest {
  requestId: string;
  action: PineApprovalAction;
  /** Required when action is "guide": steering text fed back to the agent. */
  guidance?: string;
}

export interface SessionControlRequest {
  sessionId: string;
}

export interface SetApprovalModeRequest extends SessionControlRequest {
  approvalMode: PineApprovalMode;
}

export interface SetApprovalModeResult {
  updated: boolean;
}

export const APPROVAL_RESPONSE_CHANNEL = "sessions:approval-response" as const;
export const QUESTIONNAIRE_RESPONSE_CHANNEL =
  "sessions:questionnaire-response" as const;

export interface RespondQuestionnaireRequest {
  requestId: string;
  submission: AskUserQuestionSubmission;
}

/**
 * Stable marker that a bash call was blocked by the project sandbox rather
 * than failing at runtime. The renderer uses it to reclassify these calls as
 * denials (warning) instead of execution failures (destructive).
 */
export const SANDBOX_DENIED_MESSAGE =
  "The project sandbox denied this command." as const;

/**
 * True when a tool-end error payload reflects a deterministic sandbox denial.
 * The payload shape varies (a bare message string, an object with
 * error/message/text, or a nested `content` block like the bash result
 * `{ content: [{ type: "text", text }] }`), so any string value inside is
 * checked for the denial marker.
 */
export function isSandboxDeniedPayload(
  payload: PineJsonValue | undefined,
): boolean {
  return containsDenialMarker(payload);
}

function containsDenialMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(SANDBOX_DENIED_MESSAGE);
  }
  if (Array.isArray(value)) {
    return value.some(containsDenialMarker);
  }
  if (value && typeof value === "object") {
    return Object.values(value).some(containsDenialMarker);
  }
  return false;
}

export type PineJsonValue =
  | boolean
  | number
  | string
  | null
  | PineJsonValue[]
  | { [key: string]: PineJsonValue | undefined };

export type PineAgentRunState = "idle" | "running" | "aborting" | "failed";

/**
 * Compact, append-only assistant stream updates. Cumulative message snapshots
 * are deliberately excluded so token streaming stays O(output size) across the
 * utility-process and renderer IPC boundaries.
 */
export type PineAssistantMessageUpdate =
  | { type: "text-start"; contentIndex: number; text: string }
  | { type: "text-delta"; contentIndex: number; delta: string }
  | { type: "text-end"; contentIndex: number; text: string }
  | { type: "thinking-start"; contentIndex: number; thinking: string }
  | { type: "thinking-delta"; contentIndex: number; delta: string }
  | { type: "thinking-end"; contentIndex: number; thinking: string }
  | {
      type: "tool-call-start";
      contentIndex: number;
      id: string;
      name: string;
      input?: PineJsonValue;
    }
  | {
      type: "tool-call-delta";
      contentIndex: number;
      /**
       * Raw argument JSON, used only while the agent coalesces a batch; it is
       * stripped before the update leaves the agent process.
       */
      delta?: string;
      /** Parsed live preview while the bounded argument buffer is enabled. */
      input?: PineJsonValue;
    }
  | {
      type: "tool-call-end";
      contentIndex: number;
      id: string;
      name: string;
      input?: PineJsonValue;
    };

export type PineAgentEvent =
  | {
      type: "run-state";
      sessionId: string;
      state: PineAgentRunState;
      error?: string;
    }
  | {
      type: "session-error";
      sessionId: string;
      errorId: string;
      message: string;
    }
  | {
      type: "message-start" | "message-end";
      sessionId: string;
      messageId: string;
      message: PineJsonValue;
    }
  | {
      type: "message-update";
      sessionId: string;
      messageId: string;
      updates: PineAssistantMessageUpdate[];
    }
  | {
      type: "tool-start" | "tool-update" | "tool-end";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      payload?: PineJsonValue;
      isError?: boolean;
      /** ISO time the tool started, set when a reconnect replays a running tool. */
      startedAt?: string;
    }
  | {
      type: "session-updated";
      sessionId: string;
      summary: PineSessionSummary;
    }
  | {
      type: "context-usage";
      sessionId: string;
      /** Estimated context tokens, or null when unknown (e.g. right after
       * compaction, before the next LLM response). */
      tokens: number | null;
      contextWindow: number;
      /** Context usage as percentage of the window, or null when unknown. */
      percent: number | null;
      /** Cumulative conversation cost in USD. */
      cost: number;
      /** Latest assistant request's prompt-cache hit rate, or null when the
       * provider has not reported cache usage. */
      cacheHitRate: number | null;
    }
  | {
      type: "compaction-start";
      sessionId: string;
      compactionId: string;
    }
  | {
      type: "compaction-end";
      sessionId: string;
      compactionId: string;
      status: "complete" | "error" | "aborted";
    }
  | {
      type: "steering-queue";
      sessionId: string;
      messages: string[];
    }
  | {
      type: "approval-request";
      sessionId: string;
      requestId: string;
      toolCallId: string;
      toolName: string;
      trigger: PineApprovalTrigger;
      /** Tool arguments as captured when the gate escalated. */
      input?: PineJsonValue;
      /** Why the gate escalated (sandbox stderr excerpt, policy error, …). */
      evidence?: string;
      /** Binds the approval card to the immutable worker-side call snapshot. */
      actionDigest?: string;
      autoApprovalFailure?: PineAutoApprovalFailure;
      /**
       * Fixed Pine-authored note on why the call reached the user (kept out
       * of `evidence`), shown localized next to the evidence.
       */
      reasonCode?: PineApprovalReasonCode;
      reasonDetail?: string;
      reviews?: PineApprovalReview[];
      /** Reviewer-written account of what the call does and its risks. */
      explanation?: PineApprovalExplanation;
      /** A reviewer explanation is being written and follows as approval-explanation. */
      explanationPending?: boolean;
    }
  | {
      /** Late reviewer explanation; without `explanation`, none is coming. */
      type: "approval-explanation";
      sessionId: string;
      requestId: string;
      toolCallId: string;
      explanation?: PineApprovalExplanation;
    }
  | {
      type: "approval-decided";
      sessionId: string;
      requestId: string;
      toolCallId: string;
      verdict: "approved" | "denied";
      /** Who decided: the user (Let Me Review) or the model judge (Auto Approve). */
      decidedBy: "user" | "judge";
      reason?: string;
      reasonCode?: PineApprovalReasonCode;
      reasonDetail?: string;
      reviews?: PineApprovalReview[];
    }
  | {
      type: "questionnaire-request";
      sessionId: string;
      requestId: string;
      toolCallId: string;
      questionnaire: AskUserQuestionParams;
    }
  | {
      type: "questionnaire-decided";
      sessionId: string;
      requestId: string;
      toolCallId: string;
      cancelled: boolean;
    }
  | {
      type: "tool-review";
      sessionId: string;
      toolCallId: string;
      toolName: string;
      /** The auto-reviewer is holding the call before it may execute. */
      state: "reviewing";
      reviews?: PineApprovalReview[];
    }
  | {
      type: "present-file";
      sessionId: string;
      toolCallId: string;
      /** Absolute path the agent asked to present, before main resolves it. */
      path: string;
      /** Line to scroll to and lines to tint, for a text file. */
      reveal?: FileReveal;
      /** Defaults to sidebar for callers that omit the display mode. */
      display?: FilePresentationDisplay;
    }
  | {
      /** Rearranges the workbench beside the session's conversation. */
      type: "workbench-command";
      sessionId: string;
      toolCallId: string;
      command: WorkbenchCommand;
    }
  | {
      /** Every task of the session, after any of them changed. */
      type: "background-tasks";
      sessionId: string;
      tasks: BackgroundTaskSnapshot[];
    }
  | {
      /**
       * A tool needs an answer only main has, such as the user's projects.
       * Main replies to the worker directly; the renderer never sees it.
       */
      type: "host-request";
      sessionId: string;
      requestId: string;
      request: PineHostRequest;
    };

/** Kept structurally equal to the worker's `AgentHostRequest`. */
export type PineHostRequest =
  | { kind: "list-projects" }
  | { kind: "teleport"; projectId: string }
  | { kind: "session"; operation: SessionHostOperation }
  | { kind: "project"; operation: ProjectHostOperation }
  | { kind: "workbench-state" }
  | { kind: "approximate-location" }
  | { kind: "automation"; operation: AutomationHostOperation }
  | { kind: "mcp"; operation: McpHostOperation };

/** Main asks only the session's owning window for its live layout. */
export interface PineWorkbenchStateRequestEvent {
  type: "workbench-state-request";
  sessionId: string;
  requestId: string;
}

/**
 * A temporary-workspace session moved into a project after its run ended.
 * Its tabs follow it; the transcript is unchanged.
 */
export interface PineSessionTeleportedEvent {
  type: "session-teleported";
  sessionId: string;
  fromProjectId: string;
  projectId: string;
}

/**
 * A presented file after the main process resolved its absolute path into a
 * tab target this window is allowed to read. The renderer only ever observes
 * this resolved form, never the raw worker request.
 */
export interface PinePresentFileEvent {
  type: "present-file";
  sessionId: string;
  projectId: string;
  toolCallId: string;
  /** Absolute path main resolved the tab target from. */
  path: string;
  target: FilePreviewTarget;
  reveal?: FileReveal;
  display?: FilePresentationDisplay;
}

/** Events the renderer receives: worker events, plus main-resolved additions. */
export type PineSessionEvent =
  | Exclude<PineAgentEvent, { type: "present-file" | "host-request" }>
  | PineWorkbenchStateRequestEvent
  | PinePresentFileEvent
  | PineSessionTeleportedEvent
  | { type: "session-reset"; sessionId: string; projectId: string };

/**
 * Identifies an earlier user message to rewrite. The transcript drops that
 * message and everything after it, and the session continues from the edited
 * text. Live messages carry renderer-only ids, so the position counted from the
 * end of the active branch is the fallback when the id is not an entry id.
 */
/** Where a message to the agent came from, when not a Pine window. */
export type PinePromptChannel = "wechat";

export interface PineMessageRewriteTarget {
  messageId: string;
  /** Number of later user messages on the active branch. */
  userMessagesAfter: number;
}

export interface PromptSessionRequest {
  locale?: "en-US" | "zh-CN";
  message: string;
  target:
    | { kind: "new"; projectId: string }
    | {
        kind: "session";
        projectId: string;
        sessionId: string;
      };
  streamingBehavior?: "follow-up" | "steer";
  /** Sandbox/permission mode for the targeted session. Defaults to
   * `auto-approve` when omitted. */
  approvalMode?: PineApprovalMode;
  /** Rewrite history from this user message instead of appending. */
  rewrite?: PineMessageRewriteTarget;
  /** Session state to change before this message, such as pre-activated
   * authoring tools; see `shared/sessionMutators.ts`. */
  mutators?: PineSessionMutator[];
}

export interface PromptSessionResult {
  accepted: boolean;
  session: PineSessionSummary;
}

export interface AbortSessionResult {
  aborted: boolean;
  sessionId?: string;
}

export interface CompactSessionResult {
  compacted: boolean;
}

export interface DequeueSteeringRequest extends SessionControlRequest {
  message: string;
}

export interface DequeueSteeringResult {
  message?: string;
  removed: boolean;
}

export interface SendSteeringNowRequest extends SessionControlRequest {
  message: string;
}

export interface SendSteeringNowResult {
  sent: boolean;
}

export type SessionEventListener = (event: PineSessionEvent) => void;
