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

/** Every `description` doubles as LLM-facing prompt copy. */
export const TodoParamsSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS),
  subject: Type.Optional(
    Type.String({ description: "Task subject line (required for create)" }),
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
        "Set this task's status (update): one of pending, in_progress, completed, deleted. When action is list, filters returned tasks by this status.",
    }),
  ),
  blockedBy: Type.Optional(
    Type.Array(Type.Number(), {
      description: "Initial blockedBy ids (create only)",
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
  "Manage a task list that shows the user step-by-step progress on multi-step, medium-to-high complexity work. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use it to break such work into several concrete, verifiable steps and keep them current as you go; do not use it for trivial or single-step requests.";

export const TODO_PROMPT_SNIPPET =
  "Track progress of multi-step, non-trivial work as a list of concrete steps, and keep it up to date";

export const TODO_PROMPT_GUIDELINES = [
  "Purpose: the todo list gives the user clear, live progress feedback on multi-step work of medium or high complexity. Use it proactively for such work — a task that needs roughly 3+ distinct steps, touches several files or components, mixes investigation with changes and verification, or when the user hands you a list of things to do. Create the list right after you understand the request, before starting the work.",
  "Do NOT create a todo list for trivial or short work: a one-step change, a quick question, a single command, reading or explaining something, or anything you can finish in one or two tool calls. A list with only one item is never useful — either the work is simple enough to skip the list, or it has not been broken down yet.",
  "Do NOT represent complex work as one umbrella task such as 'Implement the feature' or 'Fix the bug'. Split it into concrete steps (typically 3–8) that each produce a visible outcome and can be marked done on their own, e.g. 'Locate where session titles are generated', 'Add the new setting to the store', 'Wire it into the settings UI', 'Update tests and run checks'. Include verification (tests, typecheck, build) as its own step when the work needs it.",
  "Keep the list truthful over time. Do not create it and then forget it. Re-check it regularly: before each new step, after finishing a step, and whenever the plan changes. Add tasks you discover along the way, delete tasks that turn out to be unnecessary, and reword tasks whose scope changed. Before your final reply, make sure no finished work is still pending or in_progress and no task is left stale.",
  "When starting a task from the list, mark it in_progress BEFORE beginning work, with an activeForm. Mark it completed IMMEDIATELY when done — never batch completions. Exactly one task in_progress at a time.",
  "Never mark a task completed if tests are failing, the implementation is partial, or you hit unresolved errors — keep it in_progress and create a new task for the blocker instead.",
  "Task status is a 4-state machine: pending → in_progress → completed, plus deleted as a tombstone. Pass activeForm (present-continuous label, e.g. 'researching existing tool') when marking in_progress.",
  'To change a task\'s status, call update with the task id and the target status, e.g. {"action":"update","id":3,"status":"completed"} or {"action":"update","id":3,"status":"in_progress","activeForm":"writing tests"}. status is the field that changes the task; an update without a mutable field (status or another) is rejected.',
  "Use blockedBy to express dependencies (A is blocked by B). On create, pass blockedBy as the initial set. On update, use addBlockedBy / removeBlockedBy (additive merge — do not resend the full array). Cycles are rejected.",
  "list hides tombstoned (deleted) tasks by default; pass includeDeleted:true to see them. Pass status to filter by a single status. Use list to re-check the current state before updating when you are unsure.",
  "Subject must be short and imperative (e.g. 'Research existing tool'); description is for long-form detail. activeForm is a present-continuous label shown while in_progress.",
] as const;
