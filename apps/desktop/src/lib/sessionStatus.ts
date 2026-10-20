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
