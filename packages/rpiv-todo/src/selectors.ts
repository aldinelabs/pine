import type { Task, TaskState } from "./types";

/** Default content-row budget for the panel, heading included. */
export const DEFAULT_MAX_PANEL_LINES = 12;

/** Tasks without deleted tombstones. */
export function selectVisibleTasks(state: TaskState): Task[] {
  return state.tasks.filter((task) => task.status !== "deleted");
}

export interface TasksByStatus {
  pending: Task[];
  inProgress: Task[];
  completed: Task[];
}

export function selectTasksByStatus(state: TaskState): TasksByStatus {
  const visible = selectVisibleTasks(state);
  return {
    pending: visible.filter((task) => task.status === "pending"),
    inProgress: visible.filter((task) => task.status === "in_progress"),
    completed: visible.filter((task) => task.status === "completed"),
  };
}

export interface TodoCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}

export function selectTodoCounts(state: TaskState): TodoCounts {
  const groups = selectTasksByStatus(state);
  return {
    total:
      groups.pending.length +
      groups.inProgress.length +
      groups.completed.length,
    pending: groups.pending.length,
    inProgress: groups.inProgress.length,
    completed: groups.completed.length,
  };
}

/**
 * Per-row `#id` prefixes only help when a dependency points at them, so they
 * show only while a visible task carries `blockedBy`.
 */
export function selectShowTaskIds(state: TaskState): boolean {
  return selectVisibleTasks(state).some((task) =>
    Boolean(task.blockedBy?.length),
  );
}

/** Whether any visible task is still pending or in progress. */
export function selectHasActive(state: TaskState): boolean {
  return selectVisibleTasks(state).some(
    (task) => task.status === "pending" || task.status === "in_progress",
  );
}

export interface OverlayLayout {
  visible: Task[];
  hiddenCompleted: number;
  truncatedTail: number;
}

/**
 * Fits the list into `budget` body rows. On overflow one row is reserved for
 * the summary, completed tasks are dropped first (the oldest stay longest),
 * and only then is the tail of unfinished work truncated.
 */
export function selectOverlayLayout(
  state: TaskState,
  budget: number,
): OverlayLayout {
  const all = selectVisibleTasks(state);
  if (all.length <= budget) {
    return { visible: all, hiddenCompleted: 0, truncatedTail: 0 };
  }
  const innerBudget = Math.max(0, budget - 1);
  const unfinished = all.filter((task) => task.status !== "completed");
  const totalCompleted = all.length - unfinished.length;
  if (unfinished.length <= innerBudget) {
    const kept = new Set<Task>(unfinished);
    for (const task of all) {
      if (kept.size >= innerBudget) break;
      if (task.status === "completed") kept.add(task);
    }
    const visible = all.filter((task) => kept.has(task));
    const shownCompleted = visible.filter(
      (task) => task.status === "completed",
    ).length;
    return {
      visible,
      hiddenCompleted: totalCompleted - shownCompleted,
      truncatedTail: 0,
    };
  }
  return {
    visible: unfinished.slice(0, innerBudget),
    hiddenCompleted: totalCompleted,
    truncatedTail: unfinished.length - innerBudget,
  };
}
