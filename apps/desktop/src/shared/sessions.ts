import type { PineApprovalMode } from "./agent";
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

export type PineToolCallStatus = "pending" | "running" | "complete" | "error";

/** Actual reviewer attempts, captured at execution time rather than from preferences. */
export interface PineApprovalReview {
  kind: "decisions" | "model";
  providerId?: string;
  modelId?: string;
  modelName?: string;
  outcome: "allow" | "deny" | "needs_user" | "fallback" | "error";
  reason?: string;
}

export interface PineToolCallApproval {
  state: "reviewing" | "awaiting-user" | "approved" | "denied";
  decidedBy?: "user" | "judge" | "sandbox";
  reason?: string;
  reviews?: PineApprovalReview[];
}

export interface PineApprovalDecision {
  requestId: string;
  toolCallId: string;
  verdict: "approved" | "denied";
  decidedBy: "user" | "judge" | "sandbox";
  reason?: string;
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
  createdAt: string;
  id: string;
  messageCount: number;
  modelSelection?: PineModelSelection;
  name?: string;
  preview?: string;
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
      message: string;
      approvalMode: PineApprovalMode;
      locale: "en-US" | "zh-CN";
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
  | { op: "delete"; projectId: string; sessionId: string };

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
    }
  | { op: "delete"; deleted: boolean };

/** A bare `*` (or nothing) lists sessions instead of searching their text. */
export function sessionSearchQuery(query: string): string {
  const trimmed = query.trim();
  return /^\*+$/.test(trimmed) ? "" : trimmed;
}
