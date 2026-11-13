import type { TaskState } from "@pine/rpiv-todo";

/**
 * The tasks worth showing next to the conversation: deleted tombstones never
 * show, and completed tasks fade once a full turn has passed.
 */
export function visibleTodoState(
  todos: TaskState | null,
  hiddenCompletedIds: ReadonlySet<number>,
): TaskState | null {
  if (!todos) return null;
  return {
    nextId: todos.nextId,
    tasks: todos.tasks.filter(
      (task) =>
        task.status !== "deleted" &&
        !(task.status === "completed" && hiddenCompletedIds.has(task.id)),
    ),
  };
}

/** The part of a transcript message that tells whether a reply has begun. */
interface AwaitingMessage {
  role: "assistant" | "user";
  status: "complete" | "streaming";
  blocks: readonly unknown[];
}

/**
 * The run is waiting for the model's first content after the user's latest
 * message: the tail is that message, or an empty streaming reply right after
 * it. Any block (thinking, text, tool call, error) counts as content. Only
 * the last two messages are read, so the cost never grows with the
 * conversation.
 */
export function isAwaitingFirstResponse(
  messages: readonly AwaitingMessage[],
  isRunning: boolean,
): boolean {
  if (!isRunning) return false;
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role === "user") return true;
  return (
    last.status === "streaming" &&
    last.blocks.length === 0 &&
    messages.at(-2)?.role === "user"
  );
}
