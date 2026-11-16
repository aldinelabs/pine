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

/** The part of a content block that tells whether it shows anything. */
interface VisibleBlock {
  type: string;
  text?: string;
  thinking?: string;
}

/**
 * Whether a block shows anything in the transcript. Thinking and text blocks
 * open empty and fill as they stream; until they have non-blank content the
 * transcript renders nothing for them.
 */
export function isVisibleBlock(block: VisibleBlock): boolean {
  if (block.type === "thinking") return !!block.thinking?.trim();
  if (block.type === "text") return !!block.text?.trim();
  return true;
}

/** Whether any of a message's blocks shows anything in the transcript. */
export function hasVisibleBlocks(blocks: readonly VisibleBlock[]): boolean {
  return blocks.some(isVisibleBlock);
}

/** The part of a transcript message that tells whether a reply has begun. */
interface AwaitingMessage {
  role: "assistant" | "user";
  status: "complete" | "streaming";
  blocks: readonly VisibleBlock[];
}

/**
 * The run is waiting for the model's first content after the user's latest
 * message: the tail is that message, or a streaming reply right after it that
 * shows nothing yet. Any block that shows something (thinking or text with
 * non-blank content, a tool call, an error) counts as content. Only
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
    !hasVisibleBlocks(last.blocks) &&
    messages.at(-2)?.role === "user"
  );
}
