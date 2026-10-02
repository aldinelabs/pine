/**
 * Tool names and status values are the model-facing contract. Keep them
 * verbatim with the upstream extension.
 */
export const BG_RUN_TOOL_NAME = "bg_run";
export const BG_STATUS_TOOL_NAME = "bg_status";
export const BG_LOGS_TOOL_NAME = "bg_logs";
export const BG_KILL_TOOL_NAME = "bg_kill";

export const BACKGROUND_TASK_TOOL_NAMES = [
  BG_RUN_TOOL_NAME,
  BG_STATUS_TOOL_NAME,
  BG_LOGS_TOOL_NAME,
  BG_KILL_TOOL_NAME,
] as const;

export type BackgroundTaskToolName =
  (typeof BACKGROUND_TASK_TOOL_NAMES)[number];

/** Custom message type of the terminal notification. */
export const BACKGROUND_TASK_NOTIFICATION_TYPE = "background-task-notification";

export const TASK_STATUS_VALUES = [
  "running",
  "completed",
  "failed",
  "killed",
] as const;

export type BackgroundTaskStatus = (typeof TASK_STATUS_VALUES)[number];
export type TerminalBackgroundTaskStatus = Exclude<
  BackgroundTaskStatus,
  "running"
>;

/** Why a task was stopped before its command exited on its own. */
export type BackgroundTaskKillKind =
  "user" | "timeout" | "output_cap" | "shutdown";

/** Model-visible logs are bounded, as upstream. */
export const DEFAULT_LOG_BYTES = 50 * 1024;
export const MAX_LOG_BYTES = 50 * 1024;
/** A task's output file is capped; the task fails once it grows past this. */
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
/** Finished tasks kept for inspection before the oldest are dropped. */
export const MAX_RECENT_TASKS = 100;

/** A structured-clone-safe view of one task, shared with the renderer. */
export interface BackgroundTaskSnapshot {
  id: string;
  name: string;
  command: string;
  description?: string;
  status: BackgroundTaskStatus;
  /** Absolute path of the task's full output file. */
  outputPath: string;
  cwd: string;
  startTime: number;
  endTime?: number;
  exitCode?: number | null;
  bytesWritten: number;
  error?: string;
  notified: boolean;
  notifyOnCompletion: boolean;
  triggerOnCompletion: boolean;
  timeoutSeconds?: number;
  /** Ran with the user's native permissions, outside the project sandbox. */
  privileged: boolean;
}

export interface BgRunDetails {
  task: BackgroundTaskSnapshot;
}

export interface BgStatusDetails {
  tasks: BackgroundTaskSnapshot[];
}

export interface BgLogsDetails {
  task: BackgroundTaskSnapshot;
  path: string;
  bytesRead: number;
  truncated: boolean;
  tail: boolean;
}

export interface BgKillDetails {
  task: BackgroundTaskSnapshot;
  message: string;
}

/** A bounded read of a task's output file. */
export interface BackgroundTaskOutput {
  content: string;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
}
