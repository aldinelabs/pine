// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundTaskRegistry,
  type BackgroundTaskExecutor,
} from "@pine/pi-background-tasks/registry";
import type { BackgroundTaskNotificationMessage } from "@pine/pi-background-tasks";

interface FakeRun {
  command: string;
  cwd: string;
  emit(text: string): void;
  exit(code: number | null): void;
  fail(error: Error): void;
  signal: AbortSignal | undefined;
}

/** A shell that lets the test decide when each command prints and exits. */
function fakeExecutor() {
  const runs: FakeRun[] = [];
  const executor: BackgroundTaskExecutor = {
    exec: (command, cwd, options) =>
      new Promise((resolve, reject) => {
        const run: FakeRun = {
          command,
          cwd,
          signal: options.signal,
          emit: (text) => options.onData(Buffer.from(text)),
          exit: (code) => resolve({ exitCode: code }),
          fail: reject,
        };
        runs.push(run);
        // Like Pi's shell, an abort stops the process and the run rejects.
        options.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  };
  return { executor, runs };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "pine-bg-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function createRegistry(
  overrides: Partial<
    ConstructorParameters<typeof BackgroundTaskRegistry>[0]
  > = {},
) {
  const fake = fakeExecutor();
  const executorFor = vi.fn(() => fake.executor);
  const notifications: Array<{
    message: BackgroundTaskNotificationMessage;
    triggerTurn: boolean;
  }> = [];
  const onChange = vi.fn();
  let counter = 0;
  const registry = new BackgroundTaskRegistry({
    cwd: "/project",
    outputDirectory: path.join(directory, "tasks"),
    executor: executorFor,
    onChange,
    sendCompletionNotification: (message, options) => {
      notifications.push({ message, triggerTurn: options.triggerTurn });
    },
    makeTaskId: () => `b${String(++counter).padStart(4, "0")}`,
    stopWaitMs: 200,
    logger: { error: vi.fn() },
    ...overrides,
  });
  return { registry, notifications, onChange, executorFor, ...fake };
}

/** Wait for the registry's asynchronous finalization. */
async function settled(
  registry: BackgroundTaskRegistry,
  id: string,
): Promise<void> {
  await vi.waitFor(() => {
    expect(registry.snapshot(id).status).not.toBe("running");
  });
}

describe("starting tasks", () => {
  it("returns a running task immediately and runs the command in the project", async () => {
    const { registry, runs, executorFor } = createRegistry();
    const task = await registry.start("bun run dev", {
      name: "Dev server",
    });
    expect(task).toMatchObject({
      id: "b0001",
      name: "Dev server",
      status: "running",
      command: "bun run dev",
      cwd: "/project",
      privileged: false,
      notifyOnCompletion: true,
      triggerOnCompletion: false,
    });
    expect(task.outputPath).toBe(path.join(directory, "tasks", "b0001.output"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ command: "bun run dev", cwd: "/project" });
    expect(executorFor).toHaveBeenCalledWith(false);
  });

  it("asks the host for the native shell only when privileged", async () => {
    const { registry, executorFor } = createRegistry();
    await registry.start("lsof -i", { privileged: true });
    expect(executorFor).toHaveBeenCalledWith(true);
    expect(registry.snapshots()[0]?.privileged).toBe(true);
  });

  it("rejects an empty command and a closed registry", async () => {
    const { registry } = createRegistry();
    await expect(registry.start("   ")).rejects.toThrow("empty");
    await registry.dispose();
    await expect(registry.start("ls")).rejects.toThrow("closed");
  });

  it("names a task from its description or command when no name is given", async () => {
    const { registry } = createRegistry();
    expect((await registry.start("bun test")).name).toBe("bun test");
    expect(
      (await registry.start("make", { description: "Compile" })).name,
    ).toBe("Compile");
  });
});

describe("finishing", () => {
  it("completes on exit 0, keeps the output, and notifies once", async () => {
    const { registry, runs, notifications } = createRegistry();
    const { id } = await registry.start("build", {
      name: "Build",
      triggerOnCompletion: true,
    });
    runs[0]?.emit("compiling\n");
    runs[0]?.exit(0);
    await settled(registry, id);

    expect(registry.snapshot(id)).toMatchObject({
      status: "completed",
      exitCode: 0,
      bytesWritten: 10,
      notified: true,
    });
    expect(await readFile(registry.snapshot(id).outputPath, "utf8")).toBe(
      "compiling\n",
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.triggerTurn).toBe(true);
    expect(notifications[0]?.message.content).toContain(
      "<status>completed</status>",
    );
  });

  it("fails on a non-zero exit with the code in the error", async () => {
    const { registry, runs, notifications } = createRegistry();
    const { id } = await registry.start("false");
    runs[0]?.exit(3);
    await settled(registry, id);
    expect(registry.snapshot(id)).toMatchObject({
      status: "failed",
      exitCode: 3,
      error: "Exited with code 3",
    });
    expect(notifications[0]?.message.content).toContain(
      "<error>Exited with code 3</error>",
    );
  });

  it("fails when the shell cannot run the command", async () => {
    const { registry, runs } = createRegistry();
    const { id } = await registry.start("nope");
    runs[0]?.fail(new Error("spawn failed"));
    await settled(registry, id);
    expect(registry.snapshot(id)).toMatchObject({
      status: "failed",
      error: "spawn failed",
    });
    expect(registry.snapshot(id).exitCode).toBeUndefined();
    expect(await readFile(registry.snapshot(id).outputPath, "utf8")).toContain(
      "spawn failed",
    );
  });

  it("notifies without waking the agent when asked not to trigger a turn", async () => {
    const { registry, runs, notifications } = createRegistry();
    const { id } = await registry.start("ls", { triggerOnCompletion: false });
    runs[0]?.exit(0);
    await settled(registry, id);
    expect(notifications[0]?.triggerTurn).toBe(false);
  });

  it("does not notify when completion notices are disabled", async () => {
    const { registry, runs, notifications } = createRegistry();
    const { id } = await registry.start("ls", { notifyOnCompletion: false });
    runs[0]?.exit(0);
    await settled(registry, id);
    expect(registry.snapshot(id).notified).toBe(false);
    expect(notifications).toHaveLength(0);
  });

  it("resets the notified flag when delivery fails", async () => {
    const logger = { error: vi.fn() };
    const { registry, runs } = createRegistry({
      logger,
      sendCompletionNotification: () => {
        throw new Error("session gone");
      },
    });
    const { id } = await registry.start("ls");
    runs[0]?.exit(0);
    await settled(registry, id);
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(registry.snapshot(id).notified).toBe(false);
  });

  it("reports changes as output arrives and when the task ends", async () => {
    const { registry, runs, onChange } = createRegistry();
    const { id } = await registry.start("ls");
    onChange.mockClear();
    runs[0]?.emit("a");
    expect(onChange).toHaveBeenCalledTimes(1);
    runs[0]?.exit(0);
    await settled(registry, id);
    await vi.waitFor(() =>
      expect(onChange.mock.calls.length).toBeGreaterThan(1),
    );
  });
});

describe("stopping", () => {
  it("kills a running task and records it as stopped", async () => {
    const { registry, runs, notifications } = createRegistry();
    const { id } = await registry.start("sleep 100");
    const stopped = await registry.stop(id);
    expect(runs[0]?.signal?.aborted).toBe(true);
    expect(stopped).toMatchObject({ status: "killed" });
    expect(notifications[0]?.message.content).toContain(
      "<status>killed</status>",
    );
  });

  it("resolves a task by an unambiguous id prefix", async () => {
    const { registry } = createRegistry();
    await registry.start("a");
    await registry.start("b");
    expect(registry.resolveId("b0002")).toBe("b0002");
    expect(() => registry.resolveId("b000")).toThrow("Ambiguous");
    expect(() => registry.resolveId("zzz")).toThrow("Unknown background task");
    expect(() => registry.resolveId(" ")).toThrow("Task ID is required");
  });

  it("refuses to stop a finished task", async () => {
    const { registry, runs } = createRegistry();
    const { id } = await registry.start("ls");
    runs[0]?.exit(0);
    await settled(registry, id);
    await expect(registry.stop(id)).rejects.toThrow("completed, not running");
  });

  it("gives up waiting for a process that does not exit", async () => {
    const stubborn: BackgroundTaskExecutor = {
      exec: () => new Promise(() => undefined),
    };
    const { registry } = createRegistry({ executor: () => stubborn });
    const { id } = await registry.start("hang");
    await expect(registry.stop(id)).rejects.toThrow("did not exit within");
  });

  it("stops every running task and reports the rest", async () => {
    const { registry, runs } = createRegistry();
    await registry.start("a");
    const finished = await registry.start("b");
    await registry.start("c");
    runs[1]?.exit(0);
    await settled(registry, finished.id);
    const result = await registry.stopAllRunning();
    expect(result).toEqual({ stopped: 2, failures: [] });
  });

  it("shuts tasks down quietly when the session is disposed", async () => {
    const { registry, notifications } = createRegistry();
    const { id } = await registry.start("sleep 100");
    await registry.dispose();
    expect(registry.snapshot(id).status).toBe("killed");
    expect(notifications).toHaveLength(0);
    expect(registry.isDisposed).toBe(true);
  });
});

describe("limits", () => {
  it("fails a task that runs past its timeout", async () => {
    vi.useFakeTimers();
    try {
      const { registry, notifications } = createRegistry();
      const { id } = await registry.start("sleep 100", { timeoutSeconds: 5 });
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() =>
        expect(registry.snapshot(id).status).toBe("failed"),
      );
      expect(registry.snapshot(id).error).toBe("Timed out after 5s");
      expect(notifications[0]?.message.content).toContain(
        "<error>Timed out after 5s</error>",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a timeout that is not a positive number", async () => {
    const { registry } = createRegistry();
    expect(
      (await registry.start("a", { timeoutSeconds: -1 })).timeoutSeconds,
    ).toBeUndefined();
    expect(
      (await registry.start("b", { timeoutSeconds: 2.9 })).timeoutSeconds,
    ).toBe(2);
  });

  it("fails a task whose output outgrows the cap, keeping what fit", async () => {
    const { registry, runs } = createRegistry({ maxOutputBytes: 10 });
    const { id } = await registry.start("yes");
    runs[0]?.emit("123456");
    runs[0]?.emit("7890ABCDEF");
    await settled(registry, id);
    const task = registry.snapshot(id);
    expect(task).toMatchObject({ status: "failed", bytesWritten: 10 });
    expect(task.error).toBe("Output exceeded cap of 10B");
    expect(await readFile(task.outputPath, "utf8")).toContain("1234567890");
  });

  it("drops the oldest finished tasks past the retention limit", async () => {
    const { registry, runs } = createRegistry({ maxRecentTasks: 2 });
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const { id } = await registry.start(`task ${String(index)}`);
      ids.push(id);
      runs[index]?.exit(0);
      await settled(registry, id);
    }
    await vi.waitFor(() => expect(registry.snapshots()).toHaveLength(2));
    expect(registry.snapshots().map((task) => task.id)).toEqual(ids.slice(1));
  });
});

describe("output", () => {
  async function finishedWithOutput(output: string) {
    const created = createRegistry();
    const { id } = await created.registry.start("print");
    created.runs[0]?.emit(output);
    created.runs[0]?.exit(0);
    await settled(created.registry, id);
    return { ...created, id };
  }

  it("reads the tail by default and the head on request", async () => {
    const { registry, id } = await finishedWithOutput("0123456789");
    expect(await registry.readOutput(id, 4)).toMatchObject({
      content: "6789",
      truncated: true,
      totalBytes: 10,
    });
    expect(await registry.readOutput(id, 4, false)).toMatchObject({
      content: "0123",
      truncated: true,
    });
    expect(await registry.readOutput(id, 100)).toMatchObject({
      content: "0123456789",
      truncated: false,
    });
  });

  it("explains a truncated log and points at the full file", async () => {
    const { registry, id } = await finishedWithOutput("0123456789");
    const logs = await registry.readLogs(id, 4, true);
    expect(logs.text).toContain("Showing tail 4B of 10B; 6B omitted");
    expect(logs.text).toContain(registry.snapshot(id).outputPath);
    expect(logs.details).toMatchObject({
      truncated: true,
      tail: true,
      bytesRead: 4,
    });
    const full = await registry.readLogs(id, 100, true);
    expect(full.text).toContain("0123456789");
    expect(full.text).toContain("[Full output:");
  });

  it("says so when there is no output yet", async () => {
    const { registry } = createRegistry();
    const { id } = await registry.start("quiet");
    const logs = await registry.readLogs(id, 100, true);
    expect(logs.text).toContain("(no output yet)");
  });
});

describe("rerun", () => {
  it("starts the same command again with the same options", async () => {
    const { registry, runs, executorFor } = createRegistry();
    const first = await registry.start("make", {
      name: "Compile",
      timeoutSeconds: 60,
      privileged: true,
    });
    runs[0]?.exit(0);
    await settled(registry, first.id);
    const again = await registry.rerun(first.id, {
      triggerOnCompletion: false,
    });
    expect(again).toMatchObject({
      name: "Compile",
      command: "make",
      timeoutSeconds: 60,
      privileged: true,
      triggerOnCompletion: false,
    });
    expect(again.id).not.toBe(first.id);
    expect(executorFor).toHaveBeenLastCalledWith(true);
  });
});
