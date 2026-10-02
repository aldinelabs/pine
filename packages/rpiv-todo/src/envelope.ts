import { deriveBlocks, type TaskOp } from "./reducer";
import type {
  Task,
  TaskAction,
  TaskDetails,
  TaskMutationParams,
  TaskState,
} from "./types";

/**
 * Strips control characters from model-written task text. Complete CSI/OSC
 * escape sequences are dropped whole, line breaks and tabs become spaces, and
 * bidi controls are removed so a field cannot reorder neighbouring text.
 */
export function sanitizeTaskText(value: string): string {
  return value
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(
      /(?:\u001b\]|\u009d)[^\u0007\u009c\u001b]*(?:\u0007|\u009c|\u001b\\)?/g,
      "",
    )
    .replace(/\u001b./g, "")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
      character === "\n" || character === "\r" || character === "\t" ? " " : "",
    )
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

function formatListLine(task: Task): string {
  const blockedBy = task.blockedBy?.length
    ? ` ⛓ ${task.blockedBy.map((id) => `#${id}`).join(",")}`
    : "";
  const activeForm =
    task.status === "in_progress" && task.activeForm
      ? ` (${sanitizeTaskText(task.activeForm)})`
      : "";
  return `[${task.status}] #${task.id} ${sanitizeTaskText(task.subject)}${activeForm}${blockedBy}`;
}

function formatGetLines(task: Task, state: TaskState): string {
  const blocks = deriveBlocks(state.tasks).get(task.id) ?? [];
  const lines = [
    `#${task.id} [${task.status}] ${sanitizeTaskText(task.subject)}`,
  ];
  if (task.description) {
    lines.push(`  description: ${sanitizeTaskText(task.description)}`);
  }
  if (task.activeForm) {
    lines.push(`  activeForm: ${sanitizeTaskText(task.activeForm)}`);
  }
  if (task.blockedBy?.length) {
    lines.push(
      `  blockedBy: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`,
    );
  }
  if (blocks.length) {
    lines.push(`  blocks: ${blocks.map((id) => `#${id}`).join(", ")}`);
  }
  if (task.owner) lines.push(`  owner: ${sanitizeTaskText(task.owner)}`);
  return lines.join("\n");
}

/** The LLM-facing summary. Strings match upstream byte for byte. */
export function formatTodoContent(op: TaskOp, state: TaskState): string {
  switch (op.kind) {
    case "create": {
      const task = state.tasks.find((candidate) => candidate.id === op.taskId);
      if (!task) return `Created #${op.taskId}`;
      return `Created #${task.id}: ${sanitizeTaskText(task.subject)} (pending)`;
    }
    case "update": {
      if (!op.changed) {
        return `No change: #${op.id} already matches the requested values (status: ${op.toStatus})`;
      }
      const transition =
        op.fromStatus !== op.toStatus
          ? ` (${op.fromStatus} → ${op.toStatus})`
          : "";
      return `Updated #${op.id}${transition}`;
    }
    case "delete":
      return `Deleted #${op.id}: ${sanitizeTaskText(op.subject)}`;
    case "clear":
      return `Cleared ${op.count} tasks`;
    case "list": {
      let view = state.tasks;
      if (!op.includeDeleted) {
        view = view.filter((task) => task.status !== "deleted");
      }
      if (op.statusFilter) {
        view = view.filter((task) => task.status === op.statusFilter);
      }
      return view.length === 0
        ? "No tasks"
        : view.map(formatListLine).join("\n");
    }
    case "get":
      return formatGetLines(op.task, state);
    case "error":
      return `Error: ${op.message}`;
  }
}

export interface TodoToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: TaskDetails;
}

/**
 * Builds the tool result after the reducer runs. `details` is the persistence
 * and replay snapshot: every call, including a rejected one, carries the full
 * post-call task list.
 */
export function buildTodoToolResult(
  action: TaskAction,
  params: TaskMutationParams,
  state: TaskState,
  op: TaskOp,
): TodoToolResult {
  return {
    content: [{ type: "text", text: formatTodoContent(op, state) }],
    details: {
      action,
      params: params as Record<string, unknown>,
      tasks: state.tasks,
      nextId: state.nextId,
      ...(op.kind === "error" ? { error: op.message } : {}),
    },
  };
}
