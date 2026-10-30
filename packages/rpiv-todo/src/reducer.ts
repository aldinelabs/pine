import type {
  Task,
  TaskAction,
  TaskCreateItem,
  TaskMutationParams,
  TaskState,
  TaskStatus,
} from "./types";

/**
 * Allowed transitions per source status. `completed` only moves to `deleted`;
 * `deleted` is terminal. Same-status updates are accepted separately.
 */
export const VALID_TRANSITIONS: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  pending: new Set(["in_progress", "completed", "deleted"]),
  in_progress: new Set(["pending", "completed", "deleted"]),
  completed: new Set(["deleted"]),
  deleted: new Set(),
};

export function isTransitionValid(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || VALID_TRANSITIONS[from].has(to);
}

/** Whether merging `newBlockedBy` into `taskId` would close a cycle. */
export function detectCycle(
  tasks: readonly Task[],
  taskId: number,
  newBlockedBy: readonly number[],
): boolean {
  const edges = new Map<number, number[]>();
  for (const task of tasks) {
    edges.set(
      task.id,
      task.id === taskId
        ? [...new Set([...(task.blockedBy ?? []), ...newBlockedBy])]
        : [...(task.blockedBy ?? [])],
    );
  }

  const visiting = new Set<number>();
  const visited = new Set<number>();
  const hasCycleFrom = (node: number): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (hasCycleFrom(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of edges.keys()) {
    if (hasCycleFrom(node)) return true;
  }
  return false;
}

/** Reverse edges: for each task, the tasks that list it in `blockedBy`. */
export function deriveBlocks(tasks: readonly Task[]): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  for (const task of tasks) {
    for (const dependency of task.blockedBy ?? []) {
      const dependants = blocks.get(dependency) ?? [];
      dependants.push(task.id);
      blocks.set(dependency, dependants);
    }
  }
  return blocks;
}

/**
 * Reducer outcome. The error carries its message in-band, so a rejected call
 * leaves the state untouched and still produces a result.
 */
export type TaskOp =
  | { kind: "create"; taskIds: number[] }
  | {
      kind: "update";
      id: number;
      fromStatus: TaskStatus;
      toStatus: TaskStatus;
      changed: boolean;
    }
  | { kind: "delete"; id: number; subject: string }
  | { kind: "list"; statusFilter?: TaskStatus; includeDeleted: boolean }
  | { kind: "get"; task: Task }
  | { kind: "clear"; count: number }
  | { kind: "error"; message: string };

export interface ApplyResult {
  state: TaskState;
  op: TaskOp;
}

function errorResult(state: TaskState, message: string): ApplyResult {
  return { state, op: { kind: "error", message } };
}

function sameNumberList(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Metadata round-trips through JSON persistence, so compare it as JSON. */
function sameRecord(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * A no-effect update is reported as "No change" instead of "Updated #N", so a
 * model re-issuing the same call can tell it was a no-op.
 */
function taskChanged(before: Task, after: Task): boolean {
  return (
    before.subject !== after.subject ||
    before.status !== after.status ||
    before.description !== after.description ||
    before.activeForm !== after.activeForm ||
    before.owner !== after.owner ||
    !sameNumberList(before.blockedBy, after.blockedBy) ||
    !sameRecord(before.metadata, after.metadata)
  );
}

function validateExistingDependencies(
  state: TaskState,
  field: string,
  ids: readonly number[],
): string | undefined {
  for (const dependency of ids) {
    const task = state.tasks.find((candidate) => candidate.id === dependency);
    if (!task) return `${field}: #${dependency} not found`;
    if (task.status === "deleted") return `${field}: #${dependency} is deleted`;
  }
  return undefined;
}

/**
 * `create` takes either one `subject` (a task added to a list that is under
 * way) or a whole list in `tasks`, whose steps reference each other by
 * position. A list never starts with a single step: that is either work too
 * small to track or a plan not broken down yet.
 */
function createTasks(
  state: TaskState,
  params: TaskMutationParams,
): ApplyResult {
  if (params.tasks !== undefined && params.subject !== undefined) {
    return errorResult(
      state,
      "create takes either subject (one task) or tasks (a list), not both",
    );
  }
  const batch = params.tasks !== undefined;
  let items: TaskCreateItem[];
  if (batch) {
    items = params.tasks ?? [];
    if (items.length === 0) {
      return errorResult(state, "tasks must contain at least one step");
    }
  } else {
    if (!params.subject?.trim()) {
      return errorResult(state, "subject required for create");
    }
    if (!params.blockedBy) {
      return errorResult(
        state,
        "blockedBy required for create: list the ids this task depends on, or [] when it depends on none",
      );
    }
    items = [{ ...params, dependsOn: [] }];
  }

  const hasActive = state.tasks.some(
    (task) => task.status === "pending" || task.status === "in_progress",
  );
  if (!hasActive && items.length === 1) {
    return errorResult(
      state,
      "a new todo list needs at least 2 steps: pass every step in tasks, or skip the list for single-step work",
    );
  }

  const tasks: Task[] = [];
  for (const [index, item] of items.entries()) {
    const position = index + 1;
    const label = batch ? `tasks[${position}]: ` : "";
    if (!item.subject?.trim()) {
      return errorResult(state, `${label}subject required for create`);
    }
    if (
      item.status !== undefined &&
      item.status !== "pending" &&
      item.status !== "in_progress"
    ) {
      return errorResult(
        state,
        `${label}a new task starts as pending or in_progress, not ${item.status}`,
      );
    }
    if (batch && !item.dependsOn) {
      return errorResult(
        state,
        `${label}dependsOn required: list the positions of earlier steps it needs, or [] when it depends on none`,
      );
    }
    for (const dependency of item.dependsOn ?? []) {
      if (
        !Number.isInteger(dependency) ||
        dependency < 1 ||
        dependency >= position
      ) {
        return errorResult(
          state,
          `${label}dependsOn: ${dependency} is not an earlier step (use 1 to ${position - 1})`,
        );
      }
    }
    const blockedByError = validateExistingDependencies(
      state,
      `${label}blockedBy`,
      item.blockedBy ?? [],
    );
    if (blockedByError) return errorResult(state, blockedByError);

    const blockedBy = [
      ...new Set([
        ...(item.blockedBy ?? []),
        ...(item.dependsOn ?? []).map(
          (dependency) => state.nextId + dependency - 1,
        ),
      ]),
    ];
    const task: Task = {
      id: state.nextId + index,
      subject: item.subject,
      status: item.status ?? "pending",
    };
    if (item.description) task.description = item.description;
    if (item.activeForm) task.activeForm = item.activeForm;
    if (blockedBy.length) task.blockedBy = blockedBy;
    if (!batch) {
      if (params.owner) task.owner = params.owner;
      if (params.metadata) task.metadata = { ...params.metadata };
    }
    tasks.push(task);
  }
  return {
    state: {
      tasks: [...state.tasks, ...tasks],
      nextId: state.nextId + tasks.length,
    },
    op: { kind: "create", taskIds: tasks.map((task) => task.id) },
  };
}

/**
 * Pure reducer: (state, action, params) → (state, op). Validation runs before
 * anything changes, so a rejected call returns the original state.
 */
export function applyTaskMutation(
  state: TaskState,
  action: TaskAction,
  params: TaskMutationParams,
): ApplyResult {
  switch (action) {
    case "create":
      return createTasks(state, params);

    case "update": {
      if (params.id === undefined) {
        return errorResult(state, "id required for update");
      }
      const index = state.tasks.findIndex((task) => task.id === params.id);
      const current = state.tasks[index];
      if (!current) return errorResult(state, `#${params.id} not found`);

      const hasMutation =
        params.subject !== undefined ||
        params.description !== undefined ||
        params.activeForm !== undefined ||
        params.status !== undefined ||
        params.owner !== undefined ||
        params.metadata !== undefined ||
        Boolean(params.addBlockedBy?.length) ||
        Boolean(params.removeBlockedBy?.length);
      if (!hasMutation) {
        return errorResult(
          state,
          "update requires at least one mutable field: subject, description, activeForm, status, owner, metadata, addBlockedBy, or removeBlockedBy",
        );
      }

      let status = current.status;
      if (params.status !== undefined) {
        if (!isTransitionValid(current.status, params.status)) {
          return errorResult(
            state,
            `illegal transition ${current.status} → ${params.status}`,
          );
        }
        status = params.status;
      }

      let blockedBy = [...(current.blockedBy ?? [])];
      if (params.removeBlockedBy?.length) {
        const removed = new Set(params.removeBlockedBy);
        blockedBy = blockedBy.filter((dependency) => !removed.has(dependency));
      }
      if (params.addBlockedBy?.length) {
        for (const dependency of params.addBlockedBy) {
          if (dependency === current.id) {
            return errorResult(state, `cannot block #${current.id} on itself`);
          }
          const dependencyTask = state.tasks.find(
            (task) => task.id === dependency,
          );
          if (!dependencyTask) {
            return errorResult(state, `addBlockedBy: #${dependency} not found`);
          }
          if (dependencyTask.status === "deleted") {
            return errorResult(
              state,
              `addBlockedBy: #${dependency} is deleted`,
            );
          }
          if (!blockedBy.includes(dependency)) blockedBy.push(dependency);
        }
        if (detectCycle(state.tasks, current.id, blockedBy)) {
          return errorResult(
            state,
            "addBlockedBy would create a cycle in the blockedBy graph",
          );
        }
      }

      let metadata = current.metadata;
      if (params.metadata !== undefined) {
        const merged: Record<string, unknown> = { ...(current.metadata ?? {}) };
        for (const [key, value] of Object.entries(params.metadata)) {
          if (value === null) delete merged[key];
          else merged[key] = value;
        }
        metadata = Object.keys(merged).length ? merged : undefined;
      }

      const updated: Task = { ...current, status };
      if (params.subject !== undefined) updated.subject = params.subject;
      if (params.description !== undefined) {
        updated.description = params.description;
      }
      if (params.activeForm !== undefined) {
        updated.activeForm = params.activeForm;
      }
      if (params.owner !== undefined) updated.owner = params.owner;
      if (blockedBy.length) updated.blockedBy = blockedBy;
      else delete updated.blockedBy;
      if (metadata === undefined) delete updated.metadata;
      else updated.metadata = metadata;

      const tasks = [...state.tasks];
      tasks[index] = updated;
      return {
        state: { tasks, nextId: state.nextId },
        op: {
          kind: "update",
          id: updated.id,
          fromStatus: current.status,
          toStatus: status,
          changed: taskChanged(current, updated),
        },
      };
    }

    case "list":
      return {
        state,
        op: {
          kind: "list",
          includeDeleted: params.includeDeleted === true,
          ...(params.status !== undefined
            ? { statusFilter: params.status }
            : {}),
        },
      };

    case "get": {
      if (params.id === undefined) {
        return errorResult(state, "id required for get");
      }
      const task = state.tasks.find((candidate) => candidate.id === params.id);
      if (!task) return errorResult(state, `#${params.id} not found`);
      return { state, op: { kind: "get", task } };
    }

    case "delete": {
      if (params.id === undefined) {
        return errorResult(state, "id required for delete");
      }
      const index = state.tasks.findIndex((task) => task.id === params.id);
      const current = state.tasks[index];
      if (!current) return errorResult(state, `#${params.id} not found`);
      if (current.status === "deleted") {
        return errorResult(state, `#${current.id} is already deleted`);
      }
      const tasks = [...state.tasks];
      tasks[index] = { ...current, status: "deleted" };
      return {
        state: { tasks, nextId: state.nextId },
        op: { kind: "delete", id: current.id, subject: current.subject },
      };
    }

    case "clear":
      return {
        state: { tasks: [], nextId: 1 },
        op: { kind: "clear", count: state.tasks.length },
      };
  }
}
