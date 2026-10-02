import type {
  BackgroundTaskOutput,
  BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";

export const LIST_BACKGROUND_TASKS_CHANNEL = "background-tasks:list" as const;
export const STOP_BACKGROUND_TASK_CHANNEL = "background-tasks:stop" as const;
export const STOP_ALL_BACKGROUND_TASKS_CHANNEL =
  "background-tasks:stop-all" as const;
export const RERUN_BACKGROUND_TASK_CHANNEL = "background-tasks:rerun" as const;
export const READ_BACKGROUND_TASK_OUTPUT_CHANNEL =
  "background-tasks:output" as const;

/** The panel's output view reads a larger tail than the model's logs. */
export const BACKGROUND_TASK_OUTPUT_TAIL_BYTES = 128 * 1024;

export interface BackgroundTaskRequest {
  sessionId: string;
  taskId: string;
}

export interface ListBackgroundTasksResult {
  tasks: BackgroundTaskSnapshot[];
}

export interface BackgroundTaskResult {
  task: BackgroundTaskSnapshot;
}

export interface StopAllBackgroundTasksResult {
  stopped: number;
  failures: string[];
}

export type ReadBackgroundTaskOutputResult = BackgroundTaskOutput;
