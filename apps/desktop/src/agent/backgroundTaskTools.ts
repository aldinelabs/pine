import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import {
  BG_KILL_DESCRIPTION,
  BG_KILL_PROMPT_GUIDELINES,
  BG_KILL_PROMPT_SNIPPET,
  BG_KILL_TOOL_LABEL,
  BG_KILL_TOOL_NAME,
  BG_LOGS_DESCRIPTION,
  BG_LOGS_PROMPT_GUIDELINES,
  BG_LOGS_PROMPT_SNIPPET,
  BG_LOGS_TOOL_LABEL,
  BG_LOGS_TOOL_NAME,
  BG_RUN_DESCRIPTION,
  BG_RUN_PROMPT_GUIDELINES,
  BG_RUN_PROMPT_SNIPPET,
  BG_RUN_TOOL_LABEL,
  BG_RUN_TOOL_NAME,
  BG_STATUS_DESCRIPTION,
  BG_STATUS_PROMPT_GUIDELINES,
  BG_STATUS_PROMPT_SNIPPET,
  BG_STATUS_TOOL_LABEL,
  BG_STATUS_TOOL_NAME,
  BgKillParamsSchema,
  BgLogsParamsSchema,
  BgRunParamsSchema,
  BgStatusParamsSchema,
  deriveCompletionDeliveryGuidance,
  formatSnapshotList,
  normalizeMaxBytes,
  prepareBgRunArguments,
  type BgKillDetails,
  type BgLogsDetails,
  type BgRunDetails,
  type BgStatusDetails,
} from "@pine/pi-background-tasks";
import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import type { PineApprovalMode } from "../shared/agent";
import type { ToolGate } from "./gate";

export interface BackgroundTaskToolOptions {
  registry: BackgroundTaskRegistry;
  getApprovalMode(this: void): PineApprovalMode;
  getGate(this: void): ToolGate | null;
  /**
   * Whether a task may run in the project sandbox. Windows runs sandboxed
   * commands one at a time, so a long task there would block every other
   * sandboxed call; its tasks always run natively, after review.
   */
  sandboxAvailable: boolean;
  shellName: "bash" | "powershell";
}

function textContent(text: string) {
  return [{ type: "text" as const, text }];
}

/** `bg_run`, `bg_status`, `bg_logs`, and `bg_kill` for one session's tasks. */
export function createBackgroundTaskToolDefinitions(
  options: BackgroundTaskToolOptions,
): ToolDefinition[] {
  const { registry, getApprovalMode, getGate, sandboxAvailable, shellName } =
    options;
  const sandboxGuidance = sandboxAvailable
    ? ` Without privileged, the command runs in the same project sandbox as ordinary ${shellName}: it can read shared folders and runtime files, write only read-write shared folders and the project's temporary directory, and has no network access or local servers. Set privileged:true for dev servers, network access, or paths outside the sandbox; every privileged launch is reviewed before it starts unless YOLO mode is active.`
    : ` On this platform every background task runs with the user's native permissions, outside Pine's project sandbox, and is reviewed before it starts unless YOLO mode is active.`;

  const runTool = defineTool({
    name: BG_RUN_TOOL_NAME,
    label: BG_RUN_TOOL_LABEL,
    description: `${BG_RUN_DESCRIPTION}${sandboxGuidance}`,
    promptSnippet: BG_RUN_PROMPT_SNIPPET,
    promptGuidelines: [
      ...BG_RUN_PROMPT_GUIDELINES,
      `bg_run commands use the same shell as ${shellName}. Run short commands with ${shellName}; use bg_run only when the command should keep running while you continue.`,
    ],
    parameters: BgRunParamsSchema,
    prepareArguments: (args) => prepareBgRunArguments(args),
    execute: async (toolCallId, inputParams, signal) => {
      const params = structuredClone(inputParams);
      const approvalMode = getApprovalMode();
      const privileged =
        params.privileged === true ||
        approvalMode === "YOLO" ||
        !sandboxAvailable;
      if (privileged && approvalMode !== "YOLO") {
        const gate = getGate();
        if (!gate) {
          throw new Error(
            "Privileged execution is unavailable without an approval gate.",
          );
        }
        const decision = await gate.reviewPrivilegedCall({
          toolCallId,
          toolName: BG_RUN_TOOL_NAME,
          subject: params.command,
          description: params.name,
          evidence:
            "The agent asked to start a background command with the user's native permissions, outside Pine's project sandbox. The command keeps running after this call returns, until it exits or is stopped.",
          ...(signal ? { signal } : {}),
        });
        if (decision.kind === "deny") {
          throw new Error(
            `Approval denied before execution; the background task was not started. ${decision.reason ?? "The reviewer did not allow native execution."}`,
          );
        }
      } else if (!privileged && approvalMode === "let-me-review") {
        const gate = getGate();
        if (!gate) {
          throw new Error("Execution is unavailable without an approval gate.");
        }
        const decision = await gate.reviewBashCommand({
          toolCallId,
          toolName: BG_RUN_TOOL_NAME,
          command: params.command,
          description: params.name,
          ...(signal ? { signal } : {}),
        });
        if (decision.kind === "deny") {
          throw new Error(decision.reason ?? "This call was denied.");
        }
      }
      if (signal?.aborted) throw new Error("aborted");

      const task = await registry.start(params.command, {
        name: params.name,
        ...(params.description !== undefined
          ? { description: params.description }
          : {}),
        ...(params.timeoutSeconds !== undefined
          ? { timeoutSeconds: params.timeoutSeconds }
          : {}),
        notifyOnCompletion: params.notifyOnCompletion ?? true,
        triggerOnCompletion: params.triggerOnCompletion ?? true,
        privileged,
      });
      const delivery = deriveCompletionDeliveryGuidance(
        task.notifyOnCompletion,
        task.triggerOnCompletion,
      );
      const details: BgRunDetails = { task };
      return {
        content: textContent(
          [
            `Started background task ${task.name} (${task.id})`,
            `Status: ${task.status}`,
            `Permissions: ${privileged ? "native, outside the project sandbox" : "project sandbox"}`,
            `Output: ${task.outputPath}`,
            delivery.text,
          ].join("\n"),
        ),
        details,
      };
    },
  });

  const statusTool = defineTool({
    name: BG_STATUS_TOOL_NAME,
    label: BG_STATUS_TOOL_LABEL,
    description: BG_STATUS_DESCRIPTION,
    promptSnippet: BG_STATUS_PROMPT_SNIPPET,
    promptGuidelines: [...BG_STATUS_PROMPT_GUIDELINES],
    parameters: BgStatusParamsSchema,
    prepareArguments: (args) => args as Static<typeof BgStatusParamsSchema>,
    execute: (_toolCallId, params) => {
      const tasks =
        params.taskId === undefined
          ? registry.snapshots()
          : [registry.snapshot(params.taskId)];
      const details: BgStatusDetails = { tasks };
      return Promise.resolve({
        content: textContent(formatSnapshotList(tasks)),
        details,
      });
    },
  });

  const logsTool = defineTool({
    name: BG_LOGS_TOOL_NAME,
    label: BG_LOGS_TOOL_LABEL,
    description: BG_LOGS_DESCRIPTION,
    promptSnippet: BG_LOGS_PROMPT_SNIPPET,
    promptGuidelines: [...BG_LOGS_PROMPT_GUIDELINES],
    parameters: BgLogsParamsSchema,
    prepareArguments: (args) => args as Static<typeof BgLogsParamsSchema>,
    execute: async (_toolCallId, params) => {
      const logs = await registry.readLogs(
        params.taskId,
        normalizeMaxBytes(params.maxBytes),
        params.tail ?? true,
      );
      const details: BgLogsDetails = logs.details;
      return { content: textContent(logs.text), details };
    },
  });

  const killTool = defineTool({
    name: BG_KILL_TOOL_NAME,
    label: BG_KILL_TOOL_LABEL,
    description: BG_KILL_DESCRIPTION,
    promptSnippet: BG_KILL_PROMPT_SNIPPET,
    promptGuidelines: [...BG_KILL_PROMPT_GUIDELINES],
    parameters: BgKillParamsSchema,
    prepareArguments: (args) => args as Static<typeof BgKillParamsSchema>,
    execute: async (_toolCallId, params) => {
      const task = await registry.stop(params.taskId, "user");
      const message = `Killed ${task.name} (${task.id}). Output: ${task.outputPath}`;
      const details: BgKillDetails = { task, message };
      return { content: textContent(message), details };
    },
  });

  return [runTool, statusTool, logsTool, killTool] as ToolDefinition[];
}
