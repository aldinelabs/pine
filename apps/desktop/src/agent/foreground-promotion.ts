import { AsyncLocalStorage } from "node:async_hooks";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import {
  MAX_OUTPUT_BYTES,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";

/**
 * How long a foreground shell call may hold the turn. Models tend to pick
 * optimistic timeouts, and a stuck install or script should not keep the user
 * waiting, so the harness decides this instead of the model.
 */
export const FOREGROUND_SOFT_LIMIT_SECONDS = 60;

const TAIL_LINES = 20;
const TAIL_BYTES = 4 * 1024;

/** The shell call a command runs for; names its background task. */
const shellCallContext = new AsyncLocalStorage<{ description?: string }>();

export function runInShellCall<T>(
  description: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  return shellCallContext.run({ description }, run);
}

/** The foreground call ended because its command moved to the background. */
export class MovedToBackgroundError extends Error {
  constructor(
    readonly task: BackgroundTaskSnapshot,
    readonly outputTail: string,
  ) {
    super(`Command moved to background task ${task.id}`);
  }
}

export interface ForegroundPromotionOptions {
  /** Null while the session has no background tasks; calls then just wait. */
  getRegistry: () => BackgroundTaskRegistry | null;
  privileged: boolean;
  softLimitSeconds?: number;
  now?: () => number;
}

function tailOf(chunks: Buffer[]): string {
  const text = Buffer.concat(chunks).subarray(-TAIL_BYTES).toString("utf8");
  return text.trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
}

/**
 * Wrap shell operations so a command still running at the soft limit keeps
 * running as a background task instead of blocking the turn or being killed.
 * Before the handover, aborting the call stops the command as usual. An
 * explicit timeout shorter than the soft limit keeps its old meaning; a longer
 * one carries over to the background task as its remaining time.
 */
export function withForegroundPromotion(
  operations: BashOperations,
  options: ForegroundPromotionOptions,
): BashOperations {
  const softLimitMs =
    (options.softLimitSeconds ?? FOREGROUND_SOFT_LIMIT_SECONDS) * 1000;
  const now = options.now ?? Date.now;
  return {
    exec: async (command, cwd, execOptions) => {
      const registry = options.getRegistry();
      const { timeout, signal, onData } = execOptions;
      if (
        !registry ||
        registry.isDisposed ||
        (timeout !== undefined && timeout * 1000 <= softLimitMs)
      )
        return operations.exec(command, cwd, execOptions);
      if (signal?.aborted) throw new Error("aborted");

      const startTime = now();
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });

      const captured: Buffer[] = [];
      let capturedBytes = 0;
      let deliver = (data: Buffer) => {
        if (capturedBytes < MAX_OUTPUT_BYTES) {
          captured.push(data);
          capturedBytes += data.length;
        }
        onData(data);
      };
      const run = operations.exec(command, cwd, {
        ...execOptions,
        timeout: undefined,
        signal: controller.signal,
        onData: (data) => deliver(data),
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      const limitReached = new Promise<"limit">((resolve) => {
        timer = setTimeout(() => resolve("limit"), softLimitMs);
      });
      try {
        const first = await Promise.race([run, limitReached]);
        if (first !== "limit") return first;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }

      // Hold output that arrives while the task is being registered.
      const pending: Buffer[] = [];
      deliver = (data) => pending.push(data);
      const elapsedSeconds = (now() - startTime) / 1000;
      const description = shellCallContext.getStore()?.description;
      let adopted: Awaited<ReturnType<BackgroundTaskRegistry["adopt"]>>;
      try {
        adopted = await registry.adopt(
          command,
          {
            run,
            controller,
            output: Buffer.concat(captured),
            startTime,
          },
          {
            ...(description ? { name: description, description } : {}),
            ...(timeout !== undefined
              ? {
                  timeoutSeconds: Math.max(
                    1,
                    Math.ceil(timeout - elapsedSeconds),
                  ),
                }
              : {}),
            notifyOnCompletion: true,
            triggerOnCompletion: true,
            privileged: options.privileged,
          },
        );
      } catch {
        // The session is closing: keep waiting in the foreground instead.
        deliver = (data) => {
          captured.push(data);
          onData(data);
        };
        for (const data of pending) deliver(data);
        signal?.addEventListener("abort", forwardAbort, { once: true });
        if (signal?.aborted) controller.abort();
        try {
          return await run;
        } finally {
          signal?.removeEventListener("abort", forwardAbort);
        }
      }
      for (const data of pending) adopted.append(data);
      deliver = adopted.append;
      throw new MovedToBackgroundError(
        adopted.snapshot,
        tailOf([...captured, ...pending]),
      );
    },
  };
}

/** The model-facing result of a call whose command moved to the background. */
export function movedToBackgroundResult(error: MovedToBackgroundError) {
  const { task, outputTail } = error;
  const seconds = FOREGROUND_SOFT_LIMIT_SECONDS;
  const text = [
    `The command was still running after ${seconds} seconds, so it keeps running as background task ${task.id} ("${task.name}") instead of blocking the conversation.`,
    outputTail
      ? `Last output so far:\n${outputTail}`
      : "It has printed no output so far, which can mean it is stuck waiting on the network or on input.",
    `Full output: ${task.outputPath}`,
    "Its completion is delivered as <background-task-notification> and starts a follow-up turn; do not sleep or poll to wait. Use bg_logs to inspect it, or bg_kill if it looks stuck, then fix the cause instead of rerunning the same command.",
  ].join("\n\n");
  return {
    content: [{ type: "text" as const, text }],
    details: undefined,
  };
}
