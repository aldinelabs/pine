import { type Static, Type } from "typebox";
import {
  deriveTaskNameFromCommand,
  formatSize,
  normalizeTaskName,
} from "./format";
import { DEFAULT_LOG_BYTES, MAX_LOG_BYTES } from "./types";

export const BG_RUN_TOOL_LABEL = "Background Run";
export const BG_STATUS_TOOL_LABEL = "Background Status";
export const BG_LOGS_TOOL_LABEL = "Background Logs";
export const BG_KILL_TOOL_LABEL = "Background Kill";

/**
 * Upstream's `isAgent` and `surviveReload` are dropped: Pine has no child Pi
 * telemetry or extension reload. `privileged` is Pine's: it asks to run the
 * task outside the project sandbox, which requires approval.
 */
export const BgRunParamsSchema = Type.Object({
  name: Type.String({
    description:
      "Short human-readable task name shown in Pine's background task panel. Required; use 2-6 words, not the raw command. Write it in the same language the user is using.",
  }),
  command: Type.String({
    description: "Shell command to start in the background",
  }),
  description: Type.Optional(
    Type.String({
      description: "Optional longer human-readable context for the task",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "Optional timeout; task is failed and killed when exceeded",
    }),
  ),
  notifyOnCompletion: Type.Optional(
    Type.Boolean({
      description:
        "Whether to deliver the terminal notification. Default: true; disable only when deliberately taking over completion monitoring.",
    }),
  ),
  triggerOnCompletion: Type.Optional(
    Type.Boolean({
      description:
        "Whether that notification should automatically trigger a follow-up agent turn. Default: true for bg_run; requires notifyOnCompletion.",
    }),
  ),
  privileged: Type.Optional(
    Type.Boolean({
      description:
        "Run with the user's native permissions, outside Pine's project sandbox. Default: false. Required for network access, local servers, and paths outside the shared project folders; every privileged launch is reviewed before it starts.",
    }),
  ),
});

export const BgStatusParamsSchema = Type.Object({
  taskId: Type.Optional(
    Type.String({
      description:
        "Optional task ID or unambiguous prefix. If omitted, all running/recent tasks are returned.",
    }),
  ),
});

export const BgLogsParamsSchema = Type.Object({
  taskId: Type.String({ description: "Task ID or unambiguous prefix" }),
  maxBytes: Type.Optional(
    Type.Number({
      description: `Maximum bytes to return, capped at ${formatSize(MAX_LOG_BYTES)}. Default: ${formatSize(DEFAULT_LOG_BYTES)}.`,
    }),
  ),
  tail: Type.Optional(
    Type.Boolean({
      description:
        "Read the tail of the log when true, head when false. Default: true.",
    }),
  ),
});

export const BgKillParamsSchema = Type.Object({
  taskId: Type.String({ description: "Task ID or unambiguous prefix to stop" }),
});

export type BgRunParams = Static<typeof BgRunParamsSchema>;
export type BgStatusParams = Static<typeof BgStatusParamsSchema>;
export type BgLogsParams = Static<typeof BgLogsParamsSchema>;
export type BgKillParams = Static<typeof BgKillParamsSchema>;

/**
 * Accept the upstream argument shape too: a missing name falls back to the
 * description or the command, and upstream-only flags are ignored.
 */
export function prepareBgRunArguments(args: unknown): BgRunParams {
  if (!args || typeof args !== "object")
    throw new Error("bg_run arguments must be an object");
  const input = args as Record<string, unknown>;
  if (typeof input.command !== "string")
    throw new Error("bg_run requires command string");
  const prepared: BgRunParams = {
    command: input.command,
    name:
      normalizeTaskName(input.name) ??
      normalizeTaskName(input.description) ??
      deriveTaskNameFromCommand(input.command),
  };
  if (typeof input.description === "string")
    prepared.description = input.description;
  if (typeof input.timeoutSeconds === "number")
    prepared.timeoutSeconds = input.timeoutSeconds;
  if (typeof input.notifyOnCompletion === "boolean")
    prepared.notifyOnCompletion = input.notifyOnCompletion;
  if (typeof input.triggerOnCompletion === "boolean")
    prepared.triggerOnCompletion = input.triggerOnCompletion;
  if (typeof input.privileged === "boolean")
    prepared.privileged = input.privileged;
  return prepared;
}

export const BG_RUN_DESCRIPTION = `Start a named long-running shell command in the background and return immediately with a task ID and output path. By default, completed, failed, or killed terminal state is delivered automatically as <background-task-notification> and starts a follow-up agent turn; do not sleep or poll merely to wait. Model-visible logs are bounded to ${formatSize(MAX_LOG_BYTES)}; the full output stays in the task's output file.`;

export const BG_RUN_PROMPT_SNIPPET =
  "Start a named long-running shell command; default terminal notification wakes a follow-up turn, so yield instead of polling";

export const BG_RUN_PROMPT_GUIDELINES = [
  "Use bg_run instead of bash for commands expected to run for a long time, such as test suites, dev servers, watchers, or builds.",
  "When using bg_run, always set name to a concise 2-6 word human-readable label for the background task panel; do not use the raw command as the name unless it is already short and meaningful.",
  "bg_run returns immediately. With notifyOnCompletion:true and triggerOnCompletion:true (both defaults), completed, failed, or killed terminal state is delivered as <background-task-notification> and automatically starts a follow-up agent turn.",
  "After a default bg_run launch, continue only independent useful work that does not merely wait for the task; otherwise briefly acknowledge it if useful, then end the current turn. Do not call sleep, bg_status, or bg_logs merely to wait; the terminal notification will wake you.",
  "Treat <background-task-notification> as durable terminal truth. Do not call bg_status to reconfirm it; call bg_logs only when the task output is needed.",
  "Use bg_status/bg_logs only when the user explicitly requests an update, automatic notification or wake-up was deliberately disabled, there is concrete evidence the task is hung, or a terminal notification arrived and output details are needed.",
  "Do not set notifyOnCompletion:false or triggerOnCompletion:false unless intentionally opting out of automatic completion handling.",
] as const;

export const BG_STATUS_DESCRIPTION =
  "Inspect one background task or list all running/recent background tasks. This is a point-in-time inspection tool, not a waiting primitive.";

export const BG_STATUS_PROMPT_SNIPPET =
  "Inspect point-in-time status for one or all background tasks; never poll it as a wait loop";

export const BG_STATUS_PROMPT_GUIDELINES = [
  "Use bg_status for deliberate point-in-time inspection, not as a waiting primitive.",
  "A running result is not an instruction to poll again. Do not repeatedly call bg_status while an automatic terminal notification is pending.",
  "Use bg_status when the user explicitly requests an update, automatic completion handling was disabled, or concrete evidence suggests a task is hung; terminal notifications do not need reconfirmation.",
] as const;

export const BG_LOGS_DESCRIPTION = `Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated.`;

export const BG_LOGS_PROMPT_SNIPPET =
  "Read bounded task output when needed; never tail it repeatedly as a wait loop";

export const BG_LOGS_PROMPT_GUIDELINES = [
  "Use bg_logs with a modest maxBytes value only when task output is needed, without flooding context.",
  "Do not repeatedly call bg_logs to wait for completion while an automatic terminal notification is pending.",
  "Use bg_status first only when a deliberate inspection requires the current task state; do not reconfirm a terminal notification.",
] as const;

export const BG_KILL_DESCRIPTION =
  "Stop a running background task by ID. Fails loudly if the task is unknown or already finished.";

export const BG_KILL_PROMPT_SNIPPET = "Stop a running background task by ID";

export const BG_KILL_PROMPT_GUIDELINES = [
  "Use bg_kill when the user asks to stop a background task or when a bg_run command is no longer needed.",
] as const;
