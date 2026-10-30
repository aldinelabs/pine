import { type Static, type TSchema, Type } from "typebox";

/**
 * The tool name is the persistence key for branch replay. Keep it verbatim so
 * sessions written by the upstream extension replay in Pine.
 */
export const TODO_TOOL_NAME = "todo";
export const TODO_TOOL_LABEL = "Todo";

export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "deleted",
] as const;
export const TASK_ACTIONS = [
  "create",
  "update",
  "list",
  "get",
  "delete",
  "clear",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskAction = (typeof TASK_ACTIONS)[number];

export interface Task {
  id: number;
  subject: string;
  description?: string;
  activeForm?: string;
  status: TaskStatus;
  blockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskState {
  tasks: Task[];
  nextId: number;
}

/**
 * Every `todo` result carries this snapshot under `details`; replay reads the
 * latest one back. Field names are pinned by cross-version compatibility.
 */
export interface TaskDetails {
  action: TaskAction;
  params: Record<string, unknown>;
  tasks: Task[];
  nextId: number;
  error?: string;
}

/** One step of a batch `create`. */
export interface TaskCreateItem {
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  dependsOn?: number[];
  blockedBy?: number[];
}

/** Open input bag the reducer accepts. */
export interface TaskMutationParams {
  [key: string]: unknown;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: TaskStatus;
  blockedBy?: number[];
  addBlockedBy?: number[];
  removeBlockedBy?: number[];
  owner?: string;
  metadata?: Record<string, unknown>;
  id?: number;
  includeDeleted?: boolean;
  tasks?: TaskCreateItem[];
}

export function emptyTaskState(): TaskState {
  return { tasks: [], nextId: 1 };
}

/**
 * A plain string enum, like pi-ai's `StringEnum`: some providers reject the
 * `anyOf` of literals that `Type.Union` produces.
 */
function stringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  } as TSchema);
}

/** Statuses a task may start with. */
export const CREATE_STATUSES = ["pending", "in_progress"] as const;

const TaskCreateItemSchema = Type.Object({
  subject: Type.String({ description: "Short imperative step" }),
  description: Type.Optional(
    Type.String({ description: "Long-form task description" }),
  ),
  activeForm: Type.Optional(
    Type.String({
      description: "Present-continuous label shown while in_progress",
    }),
  ),
  status: Type.Optional(
    stringEnum(CREATE_STATUSES, {
      description:
        "Starting status; set in_progress on the step you begin now (default pending)",
    }),
  ),
  dependsOn: Type.Array(Type.Number(), {
    description:
      "1-based positions of earlier steps in this same tasks array that must finish first; [] when it depends on none",
  }),
  blockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Ids of already existing tasks this step depends on",
    }),
  ),
});

/** Every `description` doubles as LLM-facing prompt copy. */
export const TodoParamsSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS),
  tasks: Type.Optional(
    Type.Array(TaskCreateItemSchema, {
      description:
        "create: all steps of the list in order, in one call. Use this instead of subject when starting a list",
    }),
  ),
  subject: Type.Optional(
    Type.String({
      description:
        "create: subject of one task added to an existing list (use tasks to start a list)",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "Long-form task description" }),
  ),
  activeForm: Type.Optional(
    Type.String({
      description:
        "Present-continuous spinner label shown while status is in_progress (e.g. 'writing tests')",
    }),
  ),
  status: Type.Optional(
    stringEnum(TASK_STATUSES, {
      description:
        "Set this task's status (update): one of pending, in_progress, completed, deleted. On create of a single task, pending or in_progress. When action is list, filters returned tasks by this status.",
    }),
  ),
  blockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        "Ids of the tasks this one depends on (required for a single-task create; [] when it depends on none)",
    }),
  ),
  addBlockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Task ids to add to blockedBy (update only, additive merge)",
    }),
  ),
  removeBlockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description:
        "Task ids to remove from blockedBy (update only, additive merge)",
    }),
  ),
  owner: Type.Optional(
    Type.String({ description: "Agent/owner assigned to this task" }),
  ),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Arbitrary metadata; pass null value for a key to delete that key on update",
    }),
  ),
  id: Type.Optional(
    Type.Number({
      description: "Task id (required for update, get, delete)",
    }),
  ),
  includeDeleted: Type.Optional(
    Type.Boolean({
      description:
        "If true, list action returns deleted (tombstoned) tasks as well. Default: false.",
    }),
  ),
});

export type TodoParams = Static<typeof TodoParamsSchema>;

export const TODO_DESCRIPTION =
  "Manage a task list that shows the user step-by-step progress on multi-step, medium-to-high complexity work. Actions: create (start a list with tasks, or add one task with subject), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Do not use it for trivial or single-step requests.";

export const TODO_PROMPT_SNIPPET =
  "Track progress of multi-step, non-trivial work as a list of concrete steps, and keep it up to date";

export const TODO_PROMPT_GUIDELINES = [
  "Use the todo list for work that needs roughly 3+ distinct steps, touches several files or components, mixes investigation with changes and verification, or when the user hands you a list of things to do. Create it right after you understand the request, before doing the work. Skip it for a one-step change, a quick question, a single command, or explaining something.",
  'Create the whole list in ONE call with tasks, in the order you will do them. Each step lists in dependsOn the 1-based positions of earlier steps it needs ([] for none), and the step you begin now starts as in_progress. Example: {"action":"create","tasks":[{"subject":"Locate where titles are generated","status":"in_progress","activeForm":"locating title generation","dependsOn":[]},{"subject":"Add the setting to the store","dependsOn":[1]},{"subject":"Wire it into the settings UI","dependsOn":[2]},{"subject":"Update docs","dependsOn":[1]},{"subject":"Run tests and typecheck","dependsOn":[3,4]}]}. A list never starts with a single step.',
  "Split work into concrete steps (typically 3–8) that each produce a visible outcome, not one umbrella task such as 'Implement the feature'. State real dependencies: a step that needs another's result depends on it, and independent steps do not depend on each other. Include verification as its own step when the work needs it.",
  "Never create tasks for work you have already finished. The list is a plan for what is ahead, not a log of what happened.",
  'Exactly one task is in_progress while you work. Mark the next step in_progress (with an activeForm) BEFORE starting it, and mark it completed IMMEDIATELY when it is done and verified, e.g. {"action":"update","id":3,"status":"completed"}. Never batch completions. Never mark a task completed while tests fail or the work is partial; keep it in_progress and add a task for the blocker.',
  "Keep the list truthful: add steps you discover with a single-task create (subject plus blockedBy ids, [] for none), reword steps whose scope changed, delete steps that became unnecessary, and use addBlockedBy / removeBlockedBy on update to change dependencies. Before your final reply, no finished work may still be pending or in_progress.",
  "list hides deleted tasks unless includeDeleted is true; pass status to filter. Subjects are short and imperative; description holds long-form detail.",
] as const;
