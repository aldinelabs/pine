import { parseAttachmentMessage, type PineAttachment } from "./attachments";
import type { PineModelSelection } from "./models";
import type { TaskState } from "@pine/rpiv-todo";
import {
  backgroundTaskNotificationTask,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";

export const SEARCH_SESSIONS_CHANNEL = "sessions:search" as const;
export const RESUME_SESSION_CHANNEL = "sessions:resume" as const;
export const LOAD_SESSION_MESSAGES_CHANNEL = "sessions:messages" as const;
export const DELETE_SESSION_CHANNEL = "sessions:delete" as const;
export const RENAME_SESSION_CHANNEL = "sessions:rename" as const;
export const EXPORT_SESSION_CHANNEL = "sessions:export" as const;
export const ATTACH_SESSION_CHANNEL = "sessions:attach" as const;

/** Custom session entry used to preserve the approval mode for exports. */
export const PINE_APPROVAL_MODE_ENTRY = "pine.approval-mode" as const;

/** Custom session entry recording that Computer Use was activated. */
export const PINE_COMPUTER_USE_ACTIVE_ENTRY =
  "pine.computer-use-active" as const;

/** Custom session entry recording that Skill Authoring was activated. */
export const PINE_SKILL_AUTHORING_ACTIVE_ENTRY =
  "pine.skill-authoring-active" as const;

/** Custom session entry recording that media generation was activated. */
export const PINE_MEDIA_GENERATION_ACTIVE_ENTRY =
  "pine.media-generation-active" as const;

/** Audit/authorization records used by the automatic approval context. */
export const PINE_AUTHORIZATION_GRANT_ENTRY =
  "pine.authorization-grant" as const;

/** Audit record preserving a tool approval decision in the session transcript. */
export const PINE_APPROVAL_DECISION_ENTRY = "pine.approval-decision" as const;

export type PineToolCallStatus = "pending" | "running" | "complete" | "error";

export interface PineToolCallApproval {
  state: "reviewing" | "awaiting-user" | "approved" | "denied";
  decidedBy?: "user" | "judge" | "sandbox";
  reason?: string;
}

export interface PineApprovalDecision {
  requestId: string;
  toolCallId: string;
  verdict: "approved" | "denied";
  decidedBy: "user" | "judge" | "sandbox";
  reason?: string;
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
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; toolCall: PineToolCall }
  | { type: "compaction"; compaction: PineCompaction }
  /** A background task's terminal notification, as delivered to the model. */
  | { type: "backgroundTask"; task: BackgroundTaskSnapshot }
  | { type: "error"; error: PineSessionError };

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
    return task ? [{ type: "backgroundTask", task }] : [];
  }
  let blocks = parseContentBlocks(record.content);
  if (record.role === "user") {
    blocks = blocks.flatMap((block): PineContentBlock[] => {
      if (block.type !== "text") return [block];
      const parsed = parseAttachmentMessage(block.text);
      return [
        ...(parsed.attachments.length > 0
          ? [{ type: "attachments" as const, attachments: parsed.attachments }]
          : []),
        ...(parsed.prompt
          ? [{ type: "text" as const, text: parsed.prompt }]
          : []),
      ];
    });
    return blocks;
  }
  if (record.role !== "assistant") return blocks;

  if (record.stopReason === "error") {
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
  if (record.role === "custom" && backgroundTaskNotificationTask(record))
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

export interface SearchSessionsRequest {
  query: string;
}

export interface SearchSessionsResult {
  sessions: SessionSearchResult[];
}

export interface ResumeSessionRequest {
  sessionId: string;
}

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

export interface DeleteSessionRequest {
  sessionId: string;
}

export interface DeleteSessionResult {
  deleted: boolean;
}

export interface RenameSessionRequest {
  name: string;
  sessionId: string;
}

export interface RenameSessionResult {
  session: PineSessionSummary;
}

export interface LoadSessionMessagesRequest {
  before?: string;
  includeOutline?: boolean;
  limit?: number;
  sessionId: string;
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

export interface ExportSessionRequest {
  sessionId: string;
}

export interface ExportSessionResult {
  path?: string;
  saved: boolean;
}

export interface AttachSessionRequest {
  sessionId: string;
}

export interface AttachSessionResult {
  attachment: PineAttachment;
}
