import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  buildCompletionNotification,
  formatDuration,
  formatSize,
  normalizeTaskName,
  deriveTaskNameFromCommand,
  type BackgroundTaskNotificationMessage,
} from "./format";
import {
  MAX_OUTPUT_BYTES,
  MAX_RECENT_TASKS,
  type BackgroundTaskKillKind,
  type BackgroundTaskOutput,
  type BackgroundTaskSnapshot,
  type BackgroundTaskStatus,
  type BgLogsDetails,
} from "./types";

/**
 * Runs one shell command. This is Pi's `BashOperations.exec` contract: output
 * streams through `onData`, aborting the signal stops the process tree, and an
 * aborted run rejects.
 */
export interface BackgroundTaskExecutor {
  exec(
    command: string,
    cwd: string,
    options: { onData: (data: Buffer) => void; signal?: AbortSignal },
  ): Promise<{ exitCode: number | null }>;
}

export interface StartBackgroundTaskOptions {
  name?: string;
  description?: string;
  timeoutSeconds?: number;
  notifyOnCompletion?: boolean;
  triggerOnCompletion?: boolean;
  privileged?: boolean;
}

export interface BackgroundTaskRegistryOptions {
  cwd: string;
  /** Directory for the task output files. */
  outputDirectory: string;
  /** The host chooses how sandboxed and native commands run. */
  executor: (privileged: boolean) => BackgroundTaskExecutor;
  /** Called on every task change, including new output. */
  onChange?: () => void;
  /** Deliver a terminal notification. A failure resets `notified`. */
  sendCompletionNotification?: (
    message: BackgroundTaskNotificationMessage,
    options: { triggerTurn: boolean },
  ) => void | Promise<void>;
  makeTaskId?: () => string;
  now?: () => number;
  maxOutputBytes?: number;
  maxRecentTasks?: number;
  /** How long a stop waits for the process to exit. */
  stopWaitMs?: number;
  logger?: Pick<Console, "error">;
}

interface BackgroundTask extends BackgroundTaskSnapshot {
  controller: AbortController;
  stream: WriteStream;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  killKind?: BackgroundTaskKillKind;
  finalized: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

export const STOP_WAIT_MS = 5_000;

function defaultTaskId(): string {
  return `b${randomBytes(4).toString("hex")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function snapshot(task: BackgroundTask): BackgroundTaskSnapshot {
  return {
    id: task.id,
    name: task.name,
    command: task.command,
    ...(task.description !== undefined
      ? { description: task.description }
      : {}),
    status: task.status,
    outputPath: task.outputPath,
    cwd: task.cwd,
    startTime: task.startTime,
    ...(task.endTime !== undefined ? { endTime: task.endTime } : {}),
    ...(task.exitCode !== undefined ? { exitCode: task.exitCode } : {}),
    bytesWritten: task.bytesWritten,
    ...(task.error !== undefined ? { error: task.error } : {}),
    notified: task.notified,
    notifyOnCompletion: task.notifyOnCompletion,
    triggerOnCompletion: task.triggerOnCompletion,
    ...(task.timeoutSeconds !== undefined
      ? { timeoutSeconds: task.timeoutSeconds }
      : {}),
    privileged: task.privileged,
  };
}

/**
 * The background tasks of one agent session. Tasks live in memory: they stop
 * when the session is disposed and are not restored when it is reopened.
 */
export class BackgroundTaskRegistry {
  private readonly tasks = new Map<string, BackgroundTask>();
  private disposed = false;
  private readonly makeTaskId: () => string;
  private readonly now: () => number;
  private readonly maxOutputBytes: number;
  private readonly maxRecentTasks: number;
  private readonly stopWaitMs: number;
  private readonly logger: Pick<Console, "error">;

  constructor(private readonly options: BackgroundTaskRegistryOptions) {
    this.makeTaskId = options.makeTaskId ?? defaultTaskId;
    this.now = options.now ?? Date.now;
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    this.maxRecentTasks = options.maxRecentTasks ?? MAX_RECENT_TASKS;
    this.stopWaitMs = options.stopWaitMs ?? STOP_WAIT_MS;
    this.logger = options.logger ?? console;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  snapshots(): BackgroundTaskSnapshot[] {
    return [...this.tasks.values()].map(snapshot);
  }

  snapshot(id: string): BackgroundTaskSnapshot {
    return snapshot(this.resolve(id));
  }

  /** An exact id or an unambiguous prefix. */
  resolveId(idOrPrefix: string): string {
    return this.resolve(idOrPrefix).id;
  }

  async start(
    command: string,
    options: StartBackgroundTaskOptions = {},
  ): Promise<BackgroundTaskSnapshot> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error("Background command is empty");
    this.assertOpen();
    await mkdir(this.options.outputDirectory, { recursive: true });
    this.assertOpen();

    let id = this.makeTaskId();
    while (this.tasks.has(id)) id = this.makeTaskId();
    const outputPath = path.join(this.options.outputDirectory, `${id}.output`);
    const timeoutSeconds =
      typeof options.timeoutSeconds === "number" &&
      Number.isFinite(options.timeoutSeconds) &&
      options.timeoutSeconds > 0
        ? Math.floor(options.timeoutSeconds)
        : undefined;
    const description = options.description?.trim() || undefined;
    let resolveDone = (): void => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const task: BackgroundTask = {
      id,
      name:
        normalizeTaskName(options.name) ??
        normalizeTaskName(description) ??
        deriveTaskNameFromCommand(normalizedCommand),
      command: normalizedCommand,
      ...(description ? { description } : {}),
      status: "running",
      outputPath,
      cwd: this.options.cwd,
      startTime: this.now(),
      bytesWritten: 0,
      notified: false,
      notifyOnCompletion: options.notifyOnCompletion ?? true,
      triggerOnCompletion: options.triggerOnCompletion ?? false,
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      privileged: options.privileged === true,
      controller: new AbortController(),
      stream: createWriteStream(outputPath, { flags: "a" }),
      finalized: false,
      done,
      resolveDone,
    };
    task.stream.on("error", (error) => {
      task.error = `Output file write failed: ${error.message}`;
      this.kill(task, "output_cap");
    });
    this.tasks.set(id, task);

    let run: Promise<{ exitCode: number | null }>;
    try {
      run = this.options
        .executor(task.privileged)
        .exec(normalizedCommand, this.options.cwd, {
          onData: (data) => this.append(task, data),
          signal: task.controller.signal,
        });
    } catch (error) {
      run = Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    void run.then(
      ({ exitCode }) => this.settle(task, exitCode),
      (error: unknown) => this.settle(task, null, error),
    );

    if (timeoutSeconds !== undefined) {
      task.timeoutHandle = setTimeout(() => {
        if (task.status !== "running") return;
        task.error = `Timed out after ${String(timeoutSeconds)}s`;
        this.writeNotice(task, `\n[background task timeout: ${task.error}]\n`);
        this.kill(task, "timeout");
      }, timeoutSeconds * 1000);
    }
    this.changed();
    return snapshot(task);
  }

  /** Stop a running task and wait for its process to exit. */
  async stop(
    idOrPrefix: string,
    kind: BackgroundTaskKillKind = "user",
  ): Promise<BackgroundTaskSnapshot> {
    const task = this.resolve(idOrPrefix);
    if (task.status !== "running") {
      throw new Error(`Task ${task.id} is ${task.status}, not running`);
    }
    this.kill(task, kind);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = await Promise.race([
      task.done.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), this.stopWaitMs);
      }),
    ]);
    clearTimeout(timer);
    if (!stopped) {
      throw new Error(
        `Task ${task.id} did not exit within ${formatDuration(this.stopWaitMs)} after cancellation`,
      );
    }
    return snapshot(task);
  }

  private async stopAllRunning(
    kind: BackgroundTaskKillKind = "user",
  ): Promise<{ stopped: number; failures: string[] }> {
    const running = [...this.tasks.values()].filter(
      (task) => task.status === "running",
    );
    const failures: string[] = [];
    let stopped = 0;
    await Promise.all(
      running.map(async (task) => {
        try {
          await this.stop(task.id, kind);
          stopped += 1;
        } catch (error) {
          failures.push(`${task.name} (${task.id}): ${errorMessage(error)}`);
        }
      }),
    );
    return { stopped, failures };
  }

  /** A bounded read of the output file, from its head or its tail. */
  async readOutput(
    idOrPrefix: string,
    maxBytes: number,
    tail = true,
  ): Promise<BackgroundTaskOutput> {
    const task = this.resolve(idOrPrefix);
    let file;
    try {
      file = await open(task.outputPath, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { content: "", bytesRead: 0, totalBytes: 0, truncated: false };
      }
      throw error;
    }
    try {
      const totalBytes = (await file.stat()).size;
      const bytesToRead = Math.max(0, Math.min(totalBytes, maxBytes));
      if (bytesToRead === 0) {
        return {
          content: "",
          bytesRead: 0,
          totalBytes,
          truncated: totalBytes > 0,
        };
      }
      const buffer = Buffer.alloc(bytesToRead);
      const position = tail ? totalBytes - bytesToRead : 0;
      const { bytesRead } = await file.read(buffer, 0, bytesToRead, position);
      return {
        content: buffer.subarray(0, bytesRead).toString("utf8"),
        bytesRead,
        totalBytes,
        truncated: totalBytes > bytesRead,
      };
    } finally {
      await file.close();
    }
  }

  /** The `bg_logs` result: bounded output with a pointer to the full file. */
  async readLogs(
    idOrPrefix: string,
    maxBytes: number,
    tail: boolean,
  ): Promise<{ text: string; details: BgLogsDetails }> {
    const task = this.resolve(idOrPrefix);
    const read = await this.readOutput(task.id, maxBytes, tail);
    const direction = tail ? "tail" : "head";
    let text = read.content.length > 0 ? read.content : "(no output yet)";
    if (read.truncated) {
      const omitted = read.totalBytes - read.bytesRead;
      const notice = `\n\n[Showing ${direction} ${formatSize(read.bytesRead)} of ${formatSize(read.totalBytes)}; ${formatSize(omitted)} omitted. Full output: ${task.outputPath}]`;
      text = tail ? `${notice}\n\n${text}` : `${text}${notice}`;
    } else {
      text += `\n\n[Full output: ${task.outputPath}]`;
    }
    return {
      text,
      details: {
        task: snapshot(task),
        path: task.outputPath,
        bytesRead: read.bytesRead,
        truncated: read.truncated,
        tail,
      },
    };
  }

  /**
   * Stop every running task without notifying the model, then refuse new
   * tasks. Called when the session closes.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const { failures } = await this.stopAllRunning("shutdown");
    for (const failure of failures) {
      this.logger.error(
        `[background-tasks] shutdown cleanup failed for ${failure}`,
      );
    }
  }

  private resolve(idOrPrefix: string): BackgroundTask {
    const id = idOrPrefix.trim();
    if (!id) throw new Error("Task ID is required");
    const exact = this.tasks.get(id);
    if (exact) return exact;
    const matches = [...this.tasks.values()].filter((task) =>
      task.id.startsWith(id),
    );
    const [onlyMatch] = matches;
    if (matches.length === 1 && onlyMatch) return onlyMatch;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous task ID prefix "${id}": ${matches.map((task) => task.id).join(", ")}`,
      );
    }
    throw new Error(`Unknown background task ID: ${id}`);
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error("Background tasks are closed for this session.");
    }
  }

  private changed(): void {
    try {
      this.options.onChange?.();
    } catch (error) {
      this.logger.error("[background-tasks] change listener failed:", error);
    }
  }

  private kill(task: BackgroundTask, kind: BackgroundTaskKillKind): void {
    if (task.status !== "running") return;
    task.killKind ??= kind;
    task.controller.abort();
  }

  private writeNotice(task: BackgroundTask, notice: string): void {
    if (!task.stream.writable) return;
    task.stream.write(notice);
  }

  private append(task: BackgroundTask, data: Buffer): void {
    if (task.finalized || !task.stream.writable || data.length === 0) return;
    const remaining = this.maxOutputBytes - task.bytesWritten;
    if (remaining > 0) {
      const chunk =
        data.length > remaining ? data.subarray(0, remaining) : data;
      task.stream.write(chunk);
      task.bytesWritten += chunk.length;
      this.changed();
    }
    if (data.length > remaining && task.killKind === undefined) {
      task.error = `Output exceeded cap of ${formatSize(this.maxOutputBytes)}`;
      this.writeNotice(task, `\n[background task output cap: ${task.error}]\n`);
      this.kill(task, "output_cap");
    }
  }

  private async settle(
    task: BackgroundTask,
    exitCode: number | null,
    failure?: unknown,
  ): Promise<void> {
    if (task.finalized) return;
    task.finalized = true;
    clearTimeout(task.timeoutHandle);

    let status: BackgroundTaskStatus;
    let error: string | undefined;
    if (task.killKind === "user" || task.killKind === "shutdown") {
      status = "killed";
    } else if (task.killKind === "timeout") {
      status = "failed";
      error = task.error ?? `Timed out after ${String(task.timeoutSeconds)}s`;
    } else if (task.killKind === "output_cap") {
      status = "failed";
      error =
        task.error ??
        `Output exceeded cap of ${formatSize(this.maxOutputBytes)}`;
    } else if (failure !== undefined) {
      status = "failed";
      error = errorMessage(failure);
      this.writeNotice(task, `\n[background task error: ${error}]\n`);
    } else if (exitCode === 0) {
      status = "completed";
    } else {
      status = "failed";
      error = `Exited with code ${exitCode === null ? "null" : String(exitCode)}`;
    }

    if (!task.stream.destroyed) {
      await new Promise<void>((resolve) => {
        task.stream.once("error", () => resolve());
        task.stream.end(() => resolve());
      });
    }
    task.endTime = this.now();
    if (failure === undefined) task.exitCode = exitCode;
    if (error) task.error = error;
    task.status = status;
    task.resolveDone();
    this.changed();
    if (await this.notify(task)) this.changed();
    this.prune();
  }

  /** Whether a notification was sent. */
  private async notify(task: BackgroundTask): Promise<boolean> {
    const send = this.options.sendCompletionNotification;
    if (!send || !task.notifyOnCompletion || task.notified || this.disposed)
      return false;
    task.notified = true;
    try {
      await send(buildCompletionNotification(snapshot(task)), {
        triggerTurn: task.triggerOnCompletion,
      });
      return true;
    } catch (error) {
      task.notified = false;
      this.logger.error(
        `[background-tasks] notification failed for ${task.id}:`,
        error,
      );
      return false;
    }
  }

  private prune(): void {
    if (this.tasks.size <= this.maxRecentTasks) return;
    const removable = [...this.tasks.values()]
      .filter((task) => task.status !== "running")
      .sort((a, b) => (a.endTime ?? a.startTime) - (b.endTime ?? b.startTime));
    while (this.tasks.size > this.maxRecentTasks && removable.length > 0) {
      const task = removable.shift();
      if (task) this.tasks.delete(task.id);
    }
  }
}
