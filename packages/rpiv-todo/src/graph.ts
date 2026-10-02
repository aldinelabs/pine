import type { Task } from "./types";

export interface TodoGraphRow {
  task: Task;
  /** Zero-based lane of the task's node. */
  lane: number;
}

/** A dependency edge, drawn from the task that must finish to the one waiting. */
export interface TodoGraphEdge {
  /** Row indexes; `from` is always above `to`. */
  from: number;
  to: number;
  fromLane: number;
  toLane: number;
  /** The dependency is completed, so it no longer blocks anything. */
  satisfied: boolean;
}

export interface TodoGraphLayout {
  rows: TodoGraphRow[];
  edges: TodoGraphEdge[];
  laneCount: number;
}

/**
 * Lays tasks out as a commit-graph style rail: one row per task, dependencies
 * above their dependants, and each node in a lane. A task continues the lane
 * of a dependency only when it is that dependency's last dependant, so a
 * lane's vertical run never passes through another node. Edges to tasks that
 * are not in `tasks` (deleted or faded) are ignored.
 */
export function layoutTodoGraph(tasks: readonly Task[]): TodoGraphLayout {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dependencies = new Map<number, number[]>(
    tasks.map((task) => [
      task.id,
      [...new Set(task.blockedBy ?? [])].filter(
        (id) => id !== task.id && byId.has(id),
      ),
    ]),
  );

  // Dependencies first, otherwise creation order. A cycle (the reducer
  // rejects them, but old sessions may carry one) just takes the next task.
  const ordered: Task[] = [];
  const placed = new Set<number>();
  const remaining = [...tasks];
  while (remaining.length > 0) {
    let index = remaining.findIndex((task) =>
      dependencies.get(task.id)?.every((id) => placed.has(id)),
    );
    if (index < 0) index = 0;
    const [task] = remaining.splice(index, 1);
    if (!task) break;
    ordered.push(task);
    placed.add(task.id);
  }

  const rowOf = new Map(ordered.map((task, row) => [task.id, row]));
  const lastDependantRow = new Map<number, number>();
  for (const task of ordered) {
    const row = rowOf.get(task.id) ?? 0;
    for (const id of dependencies.get(task.id) ?? []) {
      if ((rowOf.get(id) ?? 0) < row) {
        lastDependantRow.set(id, Math.max(lastDependantRow.get(id) ?? -1, row));
      }
    }
  }

  const laneOf = new Map<number, number>();
  /** Which task's vertical run currently holds each lane, if any. */
  const holders: Array<number | null> = [];
  for (const [row, task] of ordered.entries()) {
    const above = (dependencies.get(task.id) ?? []).filter(
      (id) => (rowOf.get(id) ?? 0) < row,
    );
    // Continue the leftmost lane that this task is the last dependant of.
    let lane = -1;
    for (const id of above) {
      const candidate = laneOf.get(id) ?? -1;
      if (
        lastDependantRow.get(id) === row &&
        holders[candidate] === id &&
        (lane < 0 || candidate < lane)
      ) {
        lane = candidate;
      }
    }
    if (lane < 0) {
      lane = holders.findIndex((holder) => holder === null);
      if (lane < 0) lane = holders.length;
    }
    laneOf.set(task.id, lane);
    // Lanes of dependencies whose last dependant is this row end here.
    for (const id of above) {
      const held = laneOf.get(id) ?? -1;
      if (lastDependantRow.get(id) === row && holders[held] === id) {
        holders[held] = null;
      }
    }
    holders[lane] = (lastDependantRow.get(task.id) ?? -1) > row ? task.id : null;
  }

  const rows = ordered.map((task) => ({ task, lane: laneOf.get(task.id) ?? 0 }));
  const edges = ordered.flatMap((task, to) =>
    (dependencies.get(task.id) ?? []).flatMap((id): TodoGraphEdge[] => {
      const from = rowOf.get(id) ?? 0;
      return from < to
        ? [
            {
              from,
              to,
              fromLane: laneOf.get(id) ?? 0,
              toLane: laneOf.get(task.id) ?? 0,
              satisfied: byId.get(id)?.status === "completed",
            },
          ]
        : [];
    }),
  );
  return {
    rows,
    edges,
    laneCount: Math.max(1, ...rows.map((row) => row.lane + 1)),
  };
}
