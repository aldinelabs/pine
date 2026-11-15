/**
 * Pine's long-term memory: notes the agent keeps across sessions. One note is
 * one Markdown file holding one fact, in a global or a project scope.
 */

export const LIST_MEMORIES_CHANNEL = "memory:list" as const;
export const READ_MEMORY_CHANNEL = "memory:read" as const;
export const SAVE_MEMORY_CHANNEL = "memory:save" as const;
export const REMOVE_MEMORY_CHANNEL = "memory:remove" as const;
export const GET_MEMORY_ENABLED_CHANNEL = "memory:get-enabled" as const;
export const SET_MEMORY_ENABLED_CHANNEL = "memory:set-enabled" as const;

export const DEFAULT_MEMORY_ENABLED = true;

export const MEMORY_READ_TOOL_NAME = "memory_read";
export const MEMORY_SAVE_TOOL_NAME = "memory_save";
export const MEMORY_REMOVE_TOOL_NAME = "memory_remove";
export const MEMORY_TOOL_NAMES = [
  MEMORY_READ_TOOL_NAME,
  MEMORY_SAVE_TOOL_NAME,
  MEMORY_REMOVE_TOOL_NAME,
] as const;

export const MEMORY_NAME_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
export const MEMORY_NAME_MAX_LENGTH = 64;
export const MEMORY_DESCRIPTION_MAX_LENGTH = 200;
export const MEMORY_CONTENT_MAX_LENGTH = 20_000;

export type PineMemoryScope = "global" | "project";

export interface PineMemorySummary {
  /** One line saying what the note holds; this is what every session sees. */
  description: string;
  name: string;
  scope: PineMemoryScope;
  /** The session that last wrote the note; absent when the user wrote it. */
  sessionId?: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  /** Whether the fact was checked or stated by the user, not only inferred. */
  verified: boolean;
}

export interface PineMemoryNote extends PineMemorySummary {
  content: string;
}

export interface MemoryScopeRequest {
  projectId?: string;
}

export interface MemoryIdentityRequest extends MemoryScopeRequest {
  name: string;
  scope: PineMemoryScope;
}

export interface SaveMemoryRequest extends MemoryIdentityRequest {
  content: string;
  description: string;
  verified: boolean;
}

export interface ListMemoriesResult {
  memories: PineMemorySummary[];
}

export interface RemoveMemoryResult {
  removed: boolean;
}

export interface MemoryEnabledResult {
  enabled: boolean;
}

export function isMemoryName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MEMORY_NAME_MAX_LENGTH &&
    new RegExp(MEMORY_NAME_PATTERN).test(value)
  );
}
