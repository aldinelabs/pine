import {
  TODO_TOOL_NAME,
  emptyTaskState,
  type TaskDetails,
  type TaskState,
} from "./types";

/** Whether a value has the persisted `details` snapshot shape. */
export function isTaskDetails(value: unknown): value is TaskDetails {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.tasks) && typeof record.nextId === "number";
}

/** A fresh, non-aliasing state from a snapshot. */
export function taskStateFromDetails(details: TaskDetails): TaskState {
  return {
    tasks: details.tasks.map((task) => ({ ...task })),
    nextId: details.nextId,
  };
}

/**
 * Rebuilds the list from session entries in chronological order: the last
 * `todo` tool result with a snapshot wins. Entries from older or corrupt
 * sessions that do not match the shape are skipped.
 */
export function replayTodoState(entries: Iterable<unknown>): TaskState {
  let state = emptyTaskState();
  for (const entry of entries) {
    const candidate = entry as {
      type?: unknown;
      message?: { role?: unknown; toolName?: unknown; details?: unknown };
    };
    if (candidate.type !== "message") continue;
    const message = candidate.message;
    if (message?.role !== "toolResult" || message.toolName !== TODO_TOOL_NAME) {
      continue;
    }
    if (isTaskDetails(message.details)) {
      state = taskStateFromDetails(message.details);
    }
  }
  return state;
}
