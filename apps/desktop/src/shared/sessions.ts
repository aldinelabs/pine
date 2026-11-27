import {
  currentToolName,
  REPORT_PROGRESS_TOOL_NAME,
  type PineApprovalMode,
} from "./agent";
import type { AutomationRunSession } from "./automation";
import { parseAttachmentMessage, type PineAttachment } from "./attachments";
import { parseQuoteMessage, type PineQuote } from "./quotes";
import type { PineModelSelection } from "./models";
import { sessionMutationToolCall } from "./sessionMutators";
import type { TaskState } from "@pine/rpiv-todo";
import {
  backgroundTaskNotificationTask,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";

export const SEARCH_SESSIONS_CHANNEL = "sessions:search" as const;
export const LIST_ALL_RECENT_SESSIONS_CHANNEL =
  "sessions:list-all-recent" as const;
export const SEARCH_ALL_SESSIONS_CHANNEL = "sessions:search-all" as const;
export const RESUME_SESSION_CHANNEL = "sessions:resume" as const;
export const LOAD_SESSION_MESSAGES_CHANNEL = "sessions:messages" as const;
export const DELETE_SESSION_CHANNEL = "sessions:delete" as const;
export const RENAME_SESSION_CHANNEL = "sessions:rename" as const;
export const EXPORT_SESSION_CHANNEL = "sessions:export" as const;
export const ATTACH_SESSION_CHANNEL = "sessions:attach" as const;

/** Custom session entry preserving the session's approval preference. */
export const PINE_APPROVAL_MODE_ENTRY = "pine.approval-mode" as const;
/** Marks a title the user chose, which the agent then leaves alone. */
export const PINE_USER_TITLE_ENTRY = "pine.user-title" as const;

/** A title the agent proposed for a session whose title the user chose. */
export const PINE_TITLE_SUGGESTION_ENTRY = "pine.title-suggestion" as const;
/** The user's answer to a title suggestion other than accepting it. */
export const PINE_TITLE_SUGGESTION_REPLY_ENTRY =
  "pine.title-suggestion-reply" as const;
export const REPLY_TITLE_SUGGESTION_CHANNEL =
  "sessions:reply-title-suggestion" as const;

/**
 * Turning a suggestion down: "dismiss" for this once, "never" so the agent
 * proposes no other title for the session. Accepting is a user rename.
 */
export type TitleSuggestionReply = "dismiss" | "never";

export interface ReplyTitleSuggestionRequest extends ProjectSessionReference {
  reply: TitleSuggestionReply;
}

export interface ReplyTitleSuggestionResult {
  session: PineSessionSummary;
}

/**
 * The agent's open title suggestion, and whether the user asked for no more.
 * A later user rename or reply settles a suggestion.
 */
export function titleSuggestionFromEntries(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): { suggestion?: string; declined: boolean } {
  let suggestion: string | undefined;
  let declined = false;
  for (const entry of entries) {
    if (entry.type !== "custom") continue;
    const data = entry.data as { name?: unknown; reply?: unknown } | undefined;
    if (entry.customType === PINE_TITLE_SUGGESTION_ENTRY)
      suggestion =
        typeof data?.name === "string" && data.name ? data.name : undefined;
    else if (entry.customType === PINE_USER_TITLE_ENTRY) suggestion = undefined;
    else if (entry.customType === PINE_TITLE_SUGGESTION_REPLY_ENTRY) {
      suggestion = undefined;
      if (data?.reply === "never") declined = true;
    }
  }
  return declined ? { declined } : { suggestion, declined };
}

/** The open title suggestion as a session summary field. */
export function titleSuggestionField(
  entries: Parameters<typeof titleSuggestionFromEntries>[0],
): { titleSuggestion?: string } {
  const { suggestion } = titleSuggestionFromEntries(entries);
  return suggestion ? { titleSuggestion: suggestion } : {};
}

/** The latest reply suggestion, or `text: null` once it has been used. */
export const PINE_REPLY_SUGGESTION_ENTRY = "pine.reply-suggestion" as const;
export const SET_REPLY_SUGGESTION_CHANNEL =
  "sessions:set-reply-suggestion" as const;

/** Reply alternatives kept with a session and the one the composer shows. */
export interface KeptReplySuggestion {
  alternatives: string[];
  index: number;
}

export interface SetReplySuggestionRequest extends ProjectSessionReference {
  /** The alternatives to keep, or null to drop the kept ones. */
  suggestion: KeptReplySuggestion | null;
}

export interface SetReplySuggestionResult {
  session: PineSessionSummary;
}

/**
 * Stored entry data. `text` is the shown alternative, which is all that
 * entries written before alternatives existed hold.
 */
interface ReplySuggestionEntryData {
  text: string | null;
  alternatives?: string[];
  index?: number;
  messageId?: string;
}

interface ReplySuggestionBranchEntry {
  type: string;
  id?: string;
  customType?: string;
  data?: unknown;
  message?: { role?: unknown };
}

/** Entries that change what the conversation ends with. */
function endsConversationTurn(entry: ReplySuggestionBranchEntry): boolean {
  return (
    entry.type === "message" ||
    entry.type === "compaction" ||
    entry.type === "branch_summary" ||
    entry.type === "context_edit"
  );
}

/** Non-empty, distinct alternatives with the index kept in range. */
export function normalizeKeptReplySuggestion(
  value: KeptReplySuggestion | null | undefined,
): KeptReplySuggestion | undefined {
  if (!value) return undefined;
  const alternatives = [
    ...new Set(
      value.alternatives.filter(
        (text): text is string => typeof text === "string" && !!text.trim(),
      ),
    ),
  ];
  if (!alternatives.length) return undefined;
  const index = Number.isInteger(value.index) ? value.index : 0;
  return {
    alternatives,
    index: Math.min(Math.max(index, 0), alternatives.length - 1),
  };
}

function keptFromEntryData(data: unknown): KeptReplySuggestion | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const { text, alternatives, index } = data as Record<string, unknown>;
  if (Array.isArray(alternatives))
    return normalizeKeptReplySuggestion({
      alternatives: alternatives as string[],
      index: typeof index === "number" ? index : 0,
    });
  // A single suggestion, as older entries store it.
  return typeof text === "string" && text
    ? { alternatives: [text], index: 0 }
    : undefined;
}

function sameKept(
  a: KeptReplySuggestion | undefined,
  b: KeptReplySuggestion | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.index === b.index &&
    a.alternatives.length === b.alternatives.length &&
    a.alternatives.every((text, index) => text === b.alternatives[index])
  );
}

/**
 * The reply alternatives kept for the end of this branch. They stay valid
 * only while the assistant message they were made for is still the last
 * message: a sent message, a newer turn, a rewind or a compaction leaves
 * them behind.
 */
export function replySuggestionFromBranch(
  branch: readonly ReplySuggestionBranchEntry[],
): KeptReplySuggestion | undefined {
  let found = false;
  let kept: KeptReplySuggestion | undefined;
  let messageId: unknown;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (
      !found &&
      entry.type === "custom" &&
      entry.customType === PINE_REPLY_SUGGESTION_ENTRY
    ) {
      found = true;
      kept = keptFromEntryData(entry.data);
      messageId = (entry.data as { messageId?: unknown } | undefined)
        ?.messageId;
      continue;
    }
    if (!endsConversationTurn(entry)) continue;
    if (!kept) return undefined;
    return entry.type === "message" &&
      entry.message?.role === "assistant" &&
      entry.id === messageId
      ? kept
      : undefined;
  }
  return undefined;
}

/**
 * The entry data that keeps `suggestion` for this branch, or undefined when
 * nothing needs writing: the branch does not end with an assistant message,
 * or the kept alternatives already match.
 */
export function replySuggestionEntryData(
  branch: readonly ReplySuggestionBranchEntry[],
  suggestion: KeptReplySuggestion | null,
): ReplySuggestionEntryData | undefined {
  const next = normalizeKeptReplySuggestion(suggestion);
  const kept = replySuggestionFromBranch(branch);
  if (sameKept(next, kept)) return undefined;
  if (!next) return { text: null };
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!endsConversationTurn(entry)) continue;
    return entry.type === "message" &&
      entry.message?.role === "assistant" &&
      typeof entry.id === "string"
      ? {
          text: next.alternatives[next.index],
          alternatives: next.alternatives,
          index: next.index,
          messageId: entry.id,
        }
      : undefined;
  }
  return undefined;
}

/** The kept reply alternatives as a session summary field. */
export function replySuggestionField(
  branch: readonly ReplySuggestionBranchEntry[],
): { replySuggestion?: KeptReplySuggestion } {
  const suggestion = replySuggestionFromBranch(branch);
  return suggestion ? { replySuggestion: suggestion } : {};
}

/** Who renames a session: the user's own title is never replaced by the agent. */
export type SessionRenamer = "user" | "agent";

/** Whether `title` is the one the user last chose for the session. */
export function isUserChosenTitle(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
  title: string | undefined,
): boolean {
  if (!title) return false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== PINE_USER_TITLE_ENTRY)
      continue;
    const data = entry.data;
    return (
      typeof data === "object" &&
      data !== null &&
      (data as { name?: unknown }).name === title
    );
  }
  return false;
}

/** Latest valid persisted preference; older sessions keep their default. */
export function approvalModeFromEntries(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
  fallback: PineApprovalMode = "auto-approve",
): PineApprovalMode {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry.type !== "custom" ||
      entry.customType !== PINE_APPROVAL_MODE_ENTRY
    )
      continue;
    const data = entry.data;
    if (typeof data !== "object" || data === null || Array.isArray(data))
      continue;
    const mode = (data as { approvalMode?: unknown }).approvalMode;
    if (
      mode === "let-me-review" ||
      mode === "auto-approve" ||
      mode === "autonomous" ||
      mode === "YOLO"
    )
      return mode;
  }
  return fallback;
}

/** Custom session entry recording that Computer Use was activated. */
export const PINE_COMPUTER_USE_ACTIVE_ENTRY =
  "pine.computer-use-active" as const;

/** Custom session entry recording that Skill Authoring was activated. */
export const PINE_SKILL_AUTHORING_ACTIVE_ENTRY =
  "pine.skill-authoring-active" as const;

/** Custom session entry recording that automation authoring was activated. */
export const PINE_AUTOMATION_AUTHORING_ACTIVE_ENTRY =
  "pine.automation-authoring-active" as const;

/** Custom session entry recording that MCP authoring was activated. */
export const PINE_MCP_AUTHORING_ACTIVE_ENTRY =
  "pine.mcp-authoring-active" as const;

/** Custom session entry recording that media generation was activated. */
export const PINE_MEDIA_GENERATION_ACTIVE_ENTRY =
  "pine.media-generation-active" as const;

/** Audit/authorization records used by the automatic approval context. */
export const PINE_AUTHORIZATION_GRANT_ENTRY =
  "pine.authorization-grant" as const;

/** Audit record preserving a tool approval decision in the session transcript. */
export const PINE_APPROVAL_DECISION_ENTRY = "pine.approval-decision" as const;

/**
 * Records a tool call the user's stop interrupted, so a reopened session
 * shows it as stopped rather than failed. Not part of the model's context.
 */
export const PINE_STOPPED_TOOL_CALL_ENTRY = "pine.stopped-tool-call" as const;

export type PineToolCallStatus = "pending" | "running" | "complete" | "error";

/** Actual reviewer attempts, captured at execution time rather than from preferences. */
export interface PineApprovalReview {
  kind: "decisions" | "model";
  providerId?: string;
  modelId?: string;
  modelName?: string;
  outcome: "allow" | "deny" | "needs_user" | "fallback" | "error";
  /** Reviewer prose or a Pine diagnostic, shown as written without a code. */
  reason?: string;
  /** Set for fixed Pine-authored reasons, which the UI shows localized. */
  reasonCode?: PineApprovalReviewReasonCode;
}

export type PineApprovalReviewReasonCode =
  | "decisionsAllow"
  | "decisionsNeedsUser"
  | "decisionsModelReview"
  | "decisionsNoAnswer"
  | "decisionsNoApiKey";

/** Reviewer-written account of a call that needs the user. Untrusted model text. */
export interface PineApprovalExplanation {
  /** What the exact call does, one plain sentence. */
  summary: string;
  /** Concrete risk points, 0–3 short items. */
  risks: string[];
}

export const APPROVAL_EXPLANATION_SUMMARY_MAX = 400;
export const APPROVAL_EXPLANATION_RISK_MAX = 240;
export const APPROVAL_EXPLANATION_RISKS_MAX = 3;

/**
 * Fixed Pine-authored approval reasons. `reason` keeps the English text for
 * the agent and older readers; the UI shows the code localized, with
 * `reasonDetail` (a raw error message) appended where the code takes one.
 */
export type PineApprovalReasonCode =
  | "autoReviewUnavailable"
  | "autoReviewerDenied"
  | "escalationLimit"
  | "authorizationUnclear";

export interface PineToolCallApproval {
  state: "reviewing" | "awaiting-user" | "approved" | "denied";
  decidedBy?: "user" | "judge" | "sandbox";
  reason?: string;
  reasonCode?: PineApprovalReasonCode;
  reasonDetail?: string;
  reviews?: PineApprovalReview[];
}

export interface PineApprovalDecision {
  requestId: string;
  toolCallId: string;
  verdict: "approved" | "denied";
  decidedBy: "user" | "judge" | "sandbox";
  reason?: string;
  reasonCode?: PineApprovalReasonCode;
  reasonDetail?: string;
  reviews?: PineApprovalReview[];
}

export interface PineToolCall {
  id: string;
  name: string;
  status: PineToolCallStatus;
  approval?: PineToolCallApproval;
  input?: unknown;
  output?: unknown;
  startedAt?: string;
  durationMs?: number;
  /**
   * The user stopped the run before this call finished: it either never ran
   * or ended because of the stop. Always paired with status "error".
   */
  stopped?: boolean;
}

export interface PineSessionModel {
  modelId: string;
  providerId: string;
}

export type PineCompactionStatus = "running" | "complete" | "error" | "aborted";

export interface PineCompaction {
  id: string;
  status: PineCompactionStatus;
}

/** Custom message a sub-session's progress leaves in its parent. */
export const PINE_SESSION_NOTICE_TYPE = "pine.session-notice" as const;
/** Marks a session file as a sub-session of the session that started it. */
export const PINE_SUB_SESSION_ENTRY = "pine.sub-session" as const;
/**
 * Marks a session started for Live Context: it is saved before its first
 * message, and an index refresh keeps it although no one has written in it.
 */
export const PINE_LIVE_CONTEXT_ENTRY = "pine.live-context" as const;

/**
 * Marks a session file as a conversation of Pine's Orchestrator
 * (shared/assistant.ts): an ordinary session in No Project with its own
 * prompt and a fixed tool list that has no tool to do work with.
 */
export const PINE_ORCHESTRATOR_ENTRY = "pine.orchestrator" as const;

/** Whether a session file is one of the Orchestrator's conversations. */
export function isOrchestratorSession(
  entries: readonly { type: string; customType?: string }[],
): boolean {
  return entries.some(
    (entry) =>
      entry.type === "custom" && entry.customType === PINE_ORCHESTRATOR_ENTRY,
  );
}

/** Whether a session file was started for Live Context. */
export function isLiveContextSession(
  entries: readonly { type: string; customType?: string }[],
): boolean {
  return entries.some(
    (entry) =>
      entry.type === "custom" && entry.customType === PINE_LIVE_CONTEXT_ENTRY,
  );
}

export interface PineSessionNotice {
  sessionId: string;
  projectId: string;
  title?: string;
  /**
   * `stopped`: the user stopped its turn (Stop, or anything else but its
   * parent's own `ui_session_stop`, which reports nothing).
   */
  state: "finished" | "failed" | "awaiting-approval" | "stopped";
}

/** The session a sub-session's file says started it. */
export function subSessionParentOf(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): string | undefined {
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PINE_SUB_SESSION_ENTRY)
      continue;
    const parent = (entry.data as { parentSessionId?: unknown } | undefined)
      ?.parentSessionId;
    if (typeof parent === "string") return parent;
  }
  return undefined;
}

/** The notice a stored or live custom message carries, if it is one. */
export function sessionNoticeOf(
  message: unknown,
): PineSessionNotice | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const record = message as Record<string, unknown>;
  if (record.customType !== PINE_SESSION_NOTICE_TYPE) return undefined;
  const details = record.details;
  if (typeof details !== "object" || details === null) return undefined;
  const notice = details as Record<string, unknown>;
  if (
    typeof notice.sessionId !== "string" ||
    typeof notice.projectId !== "string" ||
    (notice.state !== "finished" &&
      notice.state !== "failed" &&
      notice.state !== "awaiting-approval" &&
      notice.state !== "stopped")
  )
    return undefined;
  return {
    sessionId: notice.sessionId,
    projectId: notice.projectId,
    state: notice.state,
    ...(typeof notice.title === "string" ? { title: notice.title } : {}),
  };
}

export interface PineSessionError {
  message: string;
}

export type PineContentBlock =
  | { type: "text"; text: string }
  | { type: "attachments"; attachments: PineAttachment[] }
  /** Passages the user quoted from the conversation. */
  | { type: "quotes"; quotes: PineQuote[] }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; toolCall: PineToolCall }
  | { type: "compaction"; compaction: PineCompaction }
  /** A background task's terminal notification, as delivered to the model. */
  | { type: "backgroundTask"; task: BackgroundTaskSnapshot }
  /** What a sub-session reported to the session that started it. */
  | { type: "sessionNotice"; notice: PineSessionNotice }
  /** A reminder or watch that woke the Assistant. */
  | { type: "error"; error: PineSessionError }
  /** The user stopped the run before the assistant finished. */
  | { type: "stopped" };

export interface PineTextMessage {
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  blocks: PineContentBlock[];
  thinkingDurationMs?: number;
}

/**
 * The Markdown a `report_progress` call shows as reply text; undefined for
 * any other tool. Arguments still streaming, or invalid, give "".
 */
export function progressReportText(
  name: unknown,
  args: unknown,
): string | undefined {
  if (
    typeof name !== "string" ||
    currentToolName(name) !== REPORT_PROGRESS_TOOL_NAME
  )
    return undefined;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "";
  }
  const content = (args as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

/**
 * Parse a pi message `content` value (a string, or an array of
 * `text`/`thinking`/`toolCall` blocks) into ordered Pine content blocks.
 * Shared by the main-process read-back path and the renderer event store so
 * both preserve the original block order instead of flattening it.
 */
export function parseContentBlocks(content: unknown): PineContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part): PineContentBlock[] => {
    if (typeof part !== "object" || part === null || Array.isArray(part)) {
      return [];
    }
    if (part.type === "text" && typeof part.text === "string") {
      return [{ type: "text", text: part.text }];
    }
    if (part.type === "thinking" && typeof part.thinking === "string") {
      return [{ type: "thinking", thinking: part.thinking }];
    }
    if (
      part.type === "toolCall" &&
      typeof part.id === "string" &&
      typeof part.name === "string"
    ) {
      // A progress report is reply text. The swap stays one block per content
      // index, which thinking timing and render keys rely on.
      const report = progressReportText(part.name, part.arguments);
      if (report !== undefined) return [{ type: "text", text: report }];
      return [
        {
          type: "toolCall",
          toolCall: {
            id: part.id,
            name: part.name,
            status: "pending" as const,
            ...(part.arguments !== undefined ? { input: part.arguments } : {}),
          },
        },
      ];
    }
    return [];
  });
}

// Some providers record a user stop as a failed request carrying only the
// platform's abort text, e.g. when the stop lands between tool calls.
const ABORT_ERROR_MESSAGES = new Set([
  "aborted",
  "request aborted",
  "request was aborted",
  "this operation was aborted",
  "the operation was aborted",
  "the user aborted a request.",
]);

function isAbortErrorMessage(message: unknown): boolean {
  return (
    typeof message === "string" &&
    ABORT_ERROR_MESSAGES.has(message.trim().toLowerCase())
  );
}

/**
 * Parse a complete pi message, preserving its visible content and surfacing
 * assistant request failures that pi stores outside the `content` array.
 */
export function parseMessageBlocks(message: unknown): PineContentBlock[] {
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return [];
  }

  const record = message as Record<string, unknown>;
  if (record.role === "custom") {
    const task = backgroundTaskNotificationTask(record);
    if (task) return [{ type: "backgroundTask", task }];
    const notice = sessionNoticeOf(record);
    if (notice) return [{ type: "sessionNotice", notice }];
    const toolCall = sessionMutationToolCall(
      record,
      typeof record.timestamp === "number" ||
        typeof record.timestamp === "string"
        ? String(record.timestamp)
        : "",
    );
    return toolCall ? [{ type: "toolCall", toolCall }] : [];
  }
  let blocks = parseContentBlocks(record.content);
  if (record.role === "user") {
    blocks = blocks.flatMap((block): PineContentBlock[] => {
      if (block.type !== "text") return [block];
      const parsed = parseAttachmentMessage(block.text);
      const quoted = parseQuoteMessage(parsed.prompt);
      return [
        ...(parsed.attachments.length > 0
          ? [{ type: "attachments" as const, attachments: parsed.attachments }]
          : []),
        ...(quoted.quotes.length > 0
          ? [{ type: "quotes" as const, quotes: quoted.quotes }]
          : []),
        ...(quoted.prompt
          ? [{ type: "text" as const, text: quoted.prompt }]
          : []),
      ];
    });
    return blocks;
  }
  if (record.role !== "assistant") return blocks;

  if (
    record.stopReason === "aborted" ||
    (record.stopReason === "error" && isAbortErrorMessage(record.errorMessage))
  ) {
    blocks.push({ type: "stopped" });
  } else if (record.stopReason === "error") {
    blocks.push({
      type: "error",
      error: {
        message:
          typeof record.errorMessage === "string" && record.errorMessage.trim()
            ? record.errorMessage
            : "Unknown error",
      },
    });
  } else if (record.stopReason === "length") {
    blocks.push({
      type: "error",
      error: {
        message:
          "Model stopped because it reached the maximum output token limit. The response may be incomplete.",
      },
    });
  }

  return blocks;
}

/**
 * The transcript role of a Pi message. A background task notification is a
 * custom message, shown among the assistant's output like compaction.
 */
export function transcriptRole(message: unknown): "assistant" | "user" | null {
  if (typeof message !== "object" || message === null) return null;
  const record = message as Record<string, unknown>;
  if (record.role === "assistant" || record.role === "user") return record.role;
  if (
    record.role === "custom" &&
    (backgroundTaskNotificationTask(record) ||
      sessionNoticeOf(record) ||
      sessionMutationToolCall(record, ""))
  )
    return "assistant";
  return null;
}

export function contentBlocksToText(
  blocks: readonly PineContentBlock[],
): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

export interface PineSessionSummary {
  approvalMode?: PineApprovalMode;
  /** Set when the session is an automation's run. */
  automationRun?: AutomationRunSession;
  /** Started from WeChat, or sent a message from WeChat later. */
  origin?: "wechat" | "wechat-used";
  /** Started by Pine's Orchestrator: its parent is the Orchestrator. */
  fromAssistant?: true;
  /**
   * One of the Orchestrator's conversations (shared/assistant.ts). Its
   * sidebar entry opens it; it is no row in No Project's list.
   */
  orchestrator?: true;
  /**
   * Started for Live Context: until someone writes in it, its transcript
   * stays blank instead of showing the new-session welcome.
   */
  liveContext?: boolean;
  createdAt: string;
  id: string;
  messageCount: number;
  modelSelection?: PineModelSelection;
  name?: string;
  preview?: string;
  /**
   * A title the agent proposed for a session the user named; it applies only
   * once the user accepts it.
   */
  titleSuggestion?: string;
  /**
   * The unused reply alternatives for the session's last assistant message,
   * shown again in the empty composer when the session reopens.
   */
  replySuggestion?: KeptReplySuggestion;
  updatedAt: string;
}

export interface SessionSearchResult extends PineSessionSummary {
  snippet?: string;
}

/** Addresses one session inside a project this window has open. */
export interface ProjectSessionReference {
  projectId: string;
  sessionId: string;
}

export interface SearchSessionsRequest {
  projectId: string;
  query: string;
}

export interface SearchSessionsResult {
  sessions: SessionSearchResult[];
}

/** A recent session listed together with the project it belongs to. */
export interface ProjectSessionSearchResult extends SessionSearchResult {
  projectId: string;
}

export interface ListAllRecentSessionsResult {
  sessions: ProjectSessionSearchResult[];
}

export interface SearchAllSessionsRequest {
  query: string;
}

export interface SearchAllSessionsResult {
  sessions: ProjectSessionSearchResult[];
}

export type ResumeSessionRequest = ProjectSessionReference;

export interface PineContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  cost: number;
  /** Latest assistant request's prompt-cache hit rate, when reported. */
  cacheHitRate: number | null;
}

export interface ResumeSessionResult {
  session: PineSessionSummary;
  contextUsage?: PineContextUsage;
  /**
   * The session is mid-run. A window that joins a run already under way (one
   * WeChat or another window started, or after a reload) missed its
   * `run-state` event and learns it here.
   */
  running?: boolean;
}

export type DeleteSessionRequest = ProjectSessionReference;

export interface DeleteSessionResult {
  deleted: boolean;
}

export interface RenameSessionRequest extends ProjectSessionReference {
  name: string;
}

export interface RenameSessionResult {
  session: PineSessionSummary;
}

export interface LoadSessionMessagesRequest extends ProjectSessionReference {
  before?: string;
  includeOutline?: boolean;
  limit?: number;
}

export interface LoadSessionMessagesResult {
  hasMore: boolean;
  messages: PineTextMessage[];
  nextBefore?: string;
  /** All user turns, kept separate from the paginated transcript body. */
  outline?: PineTextMessage[];
  /**
   * The model's task list replayed from the whole session, sent with the
   * first page because earlier pages may never be loaded.
   */
  todos?: TaskState;
}

export type ExportSessionRequest = ProjectSessionReference;

export interface ExportSessionResult {
  path?: string;
  saved: boolean;
}

export type AttachSessionRequest = ProjectSessionReference;

export interface AttachSessionResult {
  attachment: PineAttachment;
}

/** A session as the agent sees it when searching the user's sessions. */
export interface AgentHostSession {
  id: string;
  projectId: string;
  projectName: string;
  title?: string;
  /** Where the query matched, or the start of the conversation. */
  snippet?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** The session that asked. */
  current?: true;
  /** A run of one of the user's automations. */
  automationRun?: true;
}

/** What the session tools ask of the main process. */
export type SessionHostOperation =
  | {
      op: "search";
      /** Full-text query; empty lists the most recent sessions. */
      query: string;
      /** Only this project's sessions; every project when omitted. */
      projectId?: string;
      limit: number;
    }
  | {
      op: "start";
      /** The asking session's project when omitted. */
      projectId?: string;
      /**
       * `child`: a sub-session of the asking session. `sibling`: beside it,
       * which for a sub-session means another sub-session of its parent.
       */
      relation: "child" | "sibling";
      /** Sidebar title; Pine titles it after its first exchange otherwise. */
      title?: string;
      message: string;
      approvalMode: PineApprovalMode;
      locale: "en-US" | "zh-CN";
      /**
       * The model the new session runs on, as if the user picked it in its
       * composer; the user's default model when omitted.
       */
      model?: PineModelSelection;
    }
  | {
      op: "tree";
      /** The asking session's project when omitted. */
      projectId?: string;
      /** Most unfiled sessions to list. */
      limit: number;
    }
  | {
      op: "organize";
      projectId: string;
      /** The tree's revision; a changed tree refuses the edits. */
      revision: string;
      operations: SessionTreeOperation[];
    }
  | { op: "describe"; projectId: string; sessionId: string }
  | { op: "delete"; projectId: string; sessionId: string }
  /** The asking session's parent, sub-sessions and siblings. */
  | { op: "relatives" }
  | {
      op: "read";
      sessionId: string;
      /**
       * Read any session of this project, past the parent, sub-session and
       * sibling scope; the tool sets it only after the read was approved.
       */
      projectId?: string;
      limit: number;
      /** Cursor from an earlier page, for older messages. */
      before?: string;
    }
  | {
      op: "send";
      sessionId: string;
      /**
       * Message any session of this project, past the parent, sub-session
       * and sibling scope; the tool sets it only after sending was approved.
       */
      projectId?: string;
      message: string;
      locale: "en-US" | "zh-CN";
    }
  /**
   * Stops a session's current turn, as the user's Stop does. Without
   * `projectId`, a parent, sub-session or sibling of the asking session. The
   * tool stops anything but its own sub-sessions only after that was
   * approved.
   */
  | { op: "stop"; sessionId: string; projectId?: string };

/** A related session and what it is doing now. */
export interface AgentHostRelative {
  id: string;
  title?: string;
  state: "running" | "awaiting-approval" | "idle";
  updatedAt?: string;
}

/** One message of another session, as the agent reads it. */
export interface AgentHostMessage {
  role: "user" | "assistant";
  createdAt: string;
  text: string;
}

/** One edit of a project's session folders, applied in order. */
export type SessionTreeOperation =
  | { op: "create-folder"; name: string }
  | { op: "rename-folder"; folderId: string; name: string }
  /** Its sessions move back to the project. */
  | { op: "delete-folder"; folderId: string }
  /** A `folderId` of null takes the session out of its folder. */
  | { op: "move"; sessionId: string; folderId: string | null }
  | { op: "rename-session"; sessionId: string; name: string };

/** A project's session folders as the agent sees them. */
export interface AgentHostSessionTree {
  projectId: string;
  projectName: string;
  /** Changes whenever the project or its folders change. */
  revision: string;
  folders: {
    id: string;
    name: string;
    sessions: AgentHostTreeSession[];
  }[];
  /** The most recent sessions outside every folder. */
  unfiled: AgentHostTreeSession[];
  /** Unfiled sessions beyond the limit. */
  moreUnfiled: number;
}

export interface AgentHostTreeSession {
  id: string;
  title?: string;
  updatedAt?: string;
  current?: true;
}

export type SessionHostResult =
  | { op: "search"; sessions: AgentHostSession[] }
  | {
      op: "start";
      sessionId: string;
      projectId: string;
      projectName: string;
      approvalMode: PineApprovalMode;
      /** Set when it started as a sub-session. */
      parentSessionId?: string;
    }
  | { op: "tree"; tree: AgentHostSessionTree }
  | {
      op: "organize";
      tree: AgentHostSessionTree;
      /** Ids of folders the edits created, in order. */
      createdFolderIds: string[];
    }
  | {
      op: "describe";
      session: AgentHostSession;
      /** Open in a Pine tab, so it cannot be deleted. */
      open?: true;
      /** Sub-sessions deleted along with it. */
      subSessionCount: number;
      /** What it is doing now. */
      state: AgentHostRelative["state"];
    }
  | { op: "delete"; deleted: boolean }
  | {
      op: "relatives";
      parent?: AgentHostRelative;
      children: AgentHostRelative[];
      siblings: AgentHostRelative[];
    }
  | {
      op: "read";
      sessionId: string;
      title?: string;
      messages: AgentHostMessage[];
      /** Pass as `before` for older messages; absent at the start. */
      olderCursor?: string;
    }
  | { op: "send"; delivered: "steer" | "turn" }
  /** `stopped` is false when it had no turn running by then. */
  | { op: "stop"; stopped: boolean };

/** A bare `*` (or nothing) lists sessions instead of searching their text. */
export function sessionSearchQuery(query: string): string {
  const trimmed = query.trim();
  return /^\*+$/.test(trimmed) ? "" : trimmed;
}

/**
 * A message without the routing line Pine puts before a sub-session's first
 * message or a message relayed from another session; it is not what the
 * conversation is about, so titles and previews skip it.
 */
export function withoutRelayPrefix(text: string): string {
  return parseRelayPrefix(text).body;
}

/** Where a message Pine routed into this session came from. */
export interface PineRelaySource {
  /** `parent`: the session that started this sub-session with it. */
  kind: "parent" | "session";
  sessionId: string;
  /** The sending session's title when it had one. */
  title?: string;
}

const SUB_SESSION_PREFIX = /^\[Sub-session of ([^\s.\]]+)\.[^\]]*\]\s*/;
const RELAYED_PREFIX =
  /^\[Message from session (?:"([^"\]]*)" )?\(([^)\]]+)\)\]\s*/;

/** Splits Pine's routing line from the message it introduces. */
export function parseRelayPrefix(text: string): {
  source?: PineRelaySource;
  body: string;
} {
  const started = SUB_SESSION_PREFIX.exec(text);
  if (started?.[1])
    return {
      source: { kind: "parent", sessionId: started[1] },
      body: text.slice(started[0].length),
    };
  const relayed = RELAYED_PREFIX.exec(text);
  if (relayed?.[2])
    return {
      source: {
        kind: "session",
        sessionId: relayed[2],
        ...(relayed[1] ? { title: relayed[1] } : {}),
      },
      body: text.slice(relayed[0].length),
    };
  return { body: text };
}

/** A session title made safe to quote inside a routing line. */
export function relayTitle(title: string): string {
  return title.replace(/["[\]\s]+/g, " ").trim();
}
