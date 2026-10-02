import type { PineSessionSummary } from "./sessions";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import type { FilePreviewTarget } from "./projectFiles";
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

export const PROMPT_SESSION_CHANNEL = "sessions:prompt" as const;
export const ABORT_SESSION_CHANNEL = "sessions:abort" as const;
export const COMPACT_SESSION_CHANNEL = "sessions:compact" as const;
export const DEQUEUE_STEERING_CHANNEL = "sessions:dequeue-steering" as const;
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

/** Why a tool call needed an approval decision before it could proceed. */
export type PineApprovalTrigger =
  | "pre-execution"
  | "sandbox-denied"
  | "authorize-denied"
  | "destructive-pattern"
  | "privileged-execution";

/** A failed automatic review that fell back to manual approval. */
export interface PineAutoApprovalFailure {
  /** Shared by requests from the same failed review batch. */
  id: string;
  message: string;
}

export type PineApprovalAction = "approve" | "reject" | "guide";

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
      delta: string;
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
    }
  | {
      type: "present-file";
      sessionId: string;
      toolCallId: string;
      /** Absolute path the agent asked to present, before main resolves it. */
      path: string;
    }
  | {
      /** Every task of the session, after any of them changed. */
      type: "background-tasks";
      sessionId: string;
      tasks: BackgroundTaskSnapshot[];
    };

/**
 * A presented file after the main process resolved its absolute path into a
 * tab target this window is allowed to read. The renderer only ever observes
 * this resolved form, never the raw worker request.
 */
export interface PinePresentFileEvent {
  type: "present-file";
  sessionId: string;
  toolCallId: string;
  /** Absolute path main resolved the tab target from. */
  path: string;
  target: FilePreviewTarget;
}

/** Events the renderer receives: worker events, plus main-resolved additions. */
export type PineSessionEvent =
  Exclude<PineAgentEvent, { type: "present-file" }> | PinePresentFileEvent;

/**
 * Identifies an earlier user message to rewrite. The transcript drops that
 * message and everything after it, and the session continues from the edited
 * text. Live messages carry renderer-only ids, so the position counted from the
 * end of the active branch is the fallback when the id is not an entry id.
 */
export interface PineMessageRewriteTarget {
  messageId: string;
  /** Number of later user messages on the active branch. */
  userMessagesAfter: number;
}

export interface PromptSessionRequest {
  locale?: "en-US" | "zh-CN";
  message: string;
  target:
    | { kind: "new" }
    | {
        kind: "session";
        sessionId: string;
      };
  streamingBehavior?: "follow-up" | "steer";
  /** Sandbox/permission mode for the targeted session. Defaults to
   * `auto-approve` when omitted. */
  approvalMode?: PineApprovalMode;
  /** Rewrite history from this user message instead of appending. */
  rewrite?: PineMessageRewriteTarget;
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

export type SessionEventListener = (event: PineSessionEvent) => void;
