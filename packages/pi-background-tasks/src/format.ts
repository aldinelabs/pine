import {
  BACKGROUND_TASK_NOTIFICATION_TYPE,
  DEFAULT_LOG_BYTES,
  MAX_LOG_BYTES,
  type BackgroundTaskSnapshot,
  type BackgroundTaskStatus,
} from "./types";

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function normalizeTaskName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = compactWhitespace(stripMatchingQuotes(value));
  if (!normalized) return undefined;
  return truncateChars(normalized, 80);
}

/** A readable fallback name: the package script, or the first few words. */
export function deriveTaskNameFromCommand(command: string): string {
  const normalized = compactWhitespace(stripMatchingQuotes(command));
  if (!normalized) return "Background task";

  const packageScript = /^(npm|pnpm|yarn|bun)\s+(?:(run)\s+)?([^\s;&|]+)/.exec(
    normalized,
  );
  if (packageScript) {
    const runner = packageScript[1] ?? "npm";
    const run = packageScript[2] !== undefined ? " run" : "";
    const script = packageScript[3] ?? "";
    return truncateChars(`${runner}${run} ${script}`, 48);
  }

  const words = normalized.split(/\s+/).slice(0, 5).join(" ");
  return truncateChars(words.length > 0 ? words : normalized, 48);
}

export function taskDisplayName(task: {
  name?: string | undefined;
  description?: string | undefined;
  command?: string | undefined;
  id?: string | undefined;
}): string {
  const commandName =
    task.command && task.command.length > 0
      ? deriveTaskNameFromCommand(task.command)
      : undefined;
  return (
    normalizeTaskName(task.name) ??
    normalizeTaskName(task.description) ??
    commandName ??
    task.id ??
    "Background task"
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(Math.max(0, Math.floor(ms)))}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60)
    return `${String(minutes)}m${remSeconds > 0 ? `${String(remSeconds)}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${String(hours)}h${remMinutes > 0 ? `${String(remMinutes)}m` : ""}`;
}

/** The same byte format Pi uses for tool output sizes. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function normalizeMaxBytes(
  value: unknown,
  fallback = DEFAULT_LOG_BYTES,
): number {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : fallback;
  return Math.max(1, Math.min(MAX_LOG_BYTES, raw));
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STATUS_RANK: Record<BackgroundTaskStatus, number> = {
  running: 0,
  failed: 1,
  killed: 2,
  completed: 3,
};

/** Running tasks first, then failures, stops, and completions, newest first. */
export function sortTasksForDisplay<
  T extends Pick<BackgroundTaskSnapshot, "status" | "startTime" | "endTime">,
>(tasks: readonly T[]): T[] {
  return [...tasks].sort((a, b) => {
    const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return (b.endTime ?? b.startTime) - (a.endTime ?? a.startTime);
  });
}

const STATUS_ICON: Record<BackgroundTaskStatus, string> = {
  running: "▶",
  completed: "✓",
  killed: "■",
  failed: "✗",
};

/** The `bg_status` text, one task per line with its output path. */
export function formatSnapshotList(
  tasks: readonly BackgroundTaskSnapshot[],
  now = Date.now(),
): string {
  if (tasks.length === 0) return "No background tasks in this session.";
  return tasks
    .map((task) => {
      const age = formatDuration((task.endTime ?? now) - task.startTime);
      const code =
        task.exitCode !== undefined ? ` exit=${String(task.exitCode)}` : "";
      const error = task.error ? ` error=${truncateChars(task.error, 80)}` : "";
      const native = task.privileged ? " native" : "";
      return `${STATUS_ICON[task.status]} ${task.id} ${task.status} ${age}${code}${native} — ${truncateChars(taskDisplayName(task), 90)}${error}\n    output: ${task.outputPath}`;
    })
    .join("\n");
}

export type CompletionDeliveryMode =
  "notification-and-wake" | "notification-only" | "manual-monitoring";

export interface CompletionDeliveryGuidance {
  readonly mode: CompletionDeliveryMode;
  readonly text: string;
}

/**
 * Describe the actual completion path for one `bg_run` launch. A wake request
 * cannot take effect without the notification that carries it.
 */
export function deriveCompletionDeliveryGuidance(
  notifyOnCompletion: boolean,
  triggerOnCompletion: boolean,
): CompletionDeliveryGuidance {
  if (notifyOnCompletion && triggerOnCompletion) {
    return {
      mode: "notification-and-wake",
      text: [
        "Terminal notification: enabled.",
        "Automatic follow-up turn: enabled.",
        "Next action: do not poll or sleep merely to wait; continue only independent useful work, otherwise end this turn and wait for <background-task-notification>.",
      ].join("\n"),
    };
  }
  if (notifyOnCompletion) {
    return {
      mode: "notification-only",
      text: [
        "Terminal notification: enabled.",
        "Automatic follow-up turn: disabled. The terminal notification will be delivered, but it will not start an agent turn.",
        "Next action: automatic wake-up was explicitly disabled; use bg_status/bg_logs only when deliberate monitoring is required, without tight polling.",
      ].join("\n"),
    };
  }
  return {
    mode: "manual-monitoring",
    text: [
      "Terminal notification: disabled.",
      triggerOnCompletion
        ? "Automatic follow-up turn: disabled because terminal notifications are disabled. triggerOnCompletion has no effect while notifyOnCompletion is false."
        : "Automatic follow-up turn: disabled.",
      "Next action: completion delivery was explicitly disabled; use bg_status/bg_logs only for deliberate manual monitoring, without tight polling.",
    ].join("\n"),
  };
}

export interface BackgroundTaskNotificationMessage {
  customType: typeof BACKGROUND_TASK_NOTIFICATION_TYPE;
  content: string;
  display: true;
  details: BackgroundTaskSnapshot;
}

/** The terminal notification sent to the model, as upstream. */
export function buildCompletionNotification(
  task: BackgroundTaskSnapshot,
): BackgroundTaskNotificationMessage {
  const taskName = taskDisplayName(task);
  const exit =
    task.exitCode === undefined
      ? ""
      : `  <exit-code>${String(task.exitCode)}</exit-code>`;
  const error = task.error ? `  <error>${escapeXml(task.error)}</error>` : "";
  const guidance =
    "Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.";
  const content = [
    "<background-task-notification>",
    `  <task-id>${task.id}</task-id>`,
    `  <task-name>${escapeXml(taskName)}</task-name>`,
    `  <status>${task.status}</status>`,
    exit,
    error,
    `  <output-file>${escapeXml(task.outputPath)}</output-file>`,
    `  <summary>${escapeXml(`Background task ${JSON.stringify(taskName)} ${task.status}`)}</summary>`,
    `  <guidance>${escapeXml(guidance)}</guidance>`,
    "</background-task-notification>",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    customType: BACKGROUND_TASK_NOTIFICATION_TYPE,
    content,
    display: true,
    details: task,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the task snapshot of a stored notification message, or undefined when
 * the message is anything else. Malformed details are rejected, since sessions
 * written by other hosts may carry a different shape.
 */
export function backgroundTaskNotificationTask(
  message: unknown,
): BackgroundTaskSnapshot | undefined {
  if (!isRecord(message)) return undefined;
  if (message.customType !== BACKGROUND_TASK_NOTIFICATION_TYPE)
    return undefined;
  const task = message.details;
  if (
    !isRecord(task) ||
    typeof task.id !== "string" ||
    typeof task.command !== "string" ||
    typeof task.status !== "string" ||
    !(task.status in STATUS_RANK) ||
    typeof task.startTime !== "number"
  ) {
    return undefined;
  }
  const snapshot = task as unknown as BackgroundTaskSnapshot;
  return {
    ...snapshot,
    name: taskDisplayName(snapshot),
    outputPath: typeof task.outputPath === "string" ? task.outputPath : "",
    bytesWritten: typeof task.bytesWritten === "number" ? task.bytesWritten : 0,
    privileged: task.privileged === true,
  };
}
