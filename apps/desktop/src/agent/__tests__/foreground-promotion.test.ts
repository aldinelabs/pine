// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundTaskRegistry } from "@pine/pi-background-tasks/registry";
import {
  MovedToBackgroundError,
  movedToBackgroundResult,
  runInShellCall,
  withForegroundPromotion,
} from "../foreground-promotion";

interface FakeRun {
  emit(text: string): void;
  exit(code: number | null): void;
  signal: AbortSignal | undefined;
  timeout: number | undefined;
}

/** A shell that lets the test decide when each command prints and exits. */
function fakeOperations() {
  const runs: FakeRun[] = [];
  const operations: BashOperations = {
    exec: (_command, _cwd, options) =>
      new Promise((resolve, reject) => {
        runs.push({
          emit: (text) => options.onData(Buffer.from(text)),
          exit: (code) => resolve({ exitCode: code }),
          signal: options.signal,
          timeout: options.timeout,
        });
        options.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  };
  return { operations, runs };
}

let directory: string;
let registry: BackgroundTaskRegistry;
const notifications: Array<{ content: string; triggerTurn: boolean }> = [];

beforeEach(async () => {
  vi.useFakeTimers();
  directory = await mkdtemp(path.join(os.tmpdir(), "pine-fg-"));
  notifications.length = 0;
  registry = new BackgroundTaskRegistry({
    cwd: "/project",
    outputDirectory: path.join(directory, "tasks"),
    executor: () => {
      throw new Error("adopted tasks never start a new process");
    },
    sendCompletionNotification: (message, options) => {
      notifications.push({
        content: message.content,
        triggerTurn: options.triggerTurn,
      });
    },
    makeTaskId: () => "b0001",
    logger: { error: vi.fn() },
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await registry.dispose();
  await rm(directory, { recursive: true, force: true });
});

function setup(
  getRegistry: () => BackgroundTaskRegistry | null = () => registry,
) {
  const fake = fakeOperations();
  const operations = withForegroundPromotion(fake.operations, {
    getRegistry,
    privileged: false,
    softLimitSeconds: 60,
  });
  const output: string[] = [];
  const exec = (options: { timeout?: number; signal?: AbortSignal } = {}) =>
    operations.exec("bun install", "/project", {
      onData: (data) => output.push(data.toString()),
      ...options,
    });
  return { ...fake, exec, output };
}

describe("foreground promotion", () => {
  it("returns normally when the command finishes within the soft limit", async () => {
    const { exec, runs, output } = setup();
    const result = exec({ timeout: 300 });
    runs[0]?.emit("done\n");
    runs[0]?.exit(0);
    await expect(result).resolves.toEqual({ exitCode: 0 });
    expect(output).toEqual(["done\n"]);
    expect(runs[0]?.timeout).toBeUndefined();
    expect(registry.snapshots()).toHaveLength(0);
  });

  it("moves a command still running at the soft limit to the background", async () => {
    const { exec, runs, output } = setup();
    const result = runInShellCall("Install dependencies", () => exec());
    const settled = expect(result).rejects.toBeInstanceOf(
      MovedToBackgroundError,
    );
    runs[0]?.emit("resolving\n");
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;

    const error = await result.catch((caught: unknown) => caught);
    if (!(error instanceof MovedToBackgroundError)) throw error;
    expect(error.task).toMatchObject({
      id: "b0001",
      name: "Install dependencies",
      status: "running",
      triggerOnCompletion: true,
    });
    expect(error.outputTail).toBe("resolving");
    expect(runs[0]?.signal?.aborted).toBe(false);

    // Later output goes to the task, not the finished foreground call.
    runs[0]?.emit("installed\n");
    runs[0]?.exit(0);
    await vi.waitFor(() =>
      expect(registry.snapshot("b0001").status).toBe("completed"),
    );
    expect(output).toEqual(["resolving\n"]);
    expect(await readFile(error.task.outputPath, "utf8")).toBe(
      "resolving\ninstalled\n",
    );
    expect(notifications[0]?.triggerTurn).toBe(true);
  });

  it("stops the command when the call is aborted before the handover", async () => {
    const { exec, runs } = setup();
    const controller = new AbortController();
    const result = exec({ signal: controller.signal });
    const settled = expect(result).rejects.toThrow("aborted");
    controller.abort();
    await settled;
    expect(runs[0]?.signal?.aborted).toBe(true);
  });

  it("keeps the background task alive when the finished call is aborted later", async () => {
    const { exec, runs } = setup();
    const controller = new AbortController();
    const result = exec({ signal: controller.signal });
    const settled = expect(result).rejects.toBeInstanceOf(
      MovedToBackgroundError,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    controller.abort();
    expect(runs[0]?.signal?.aborted).toBe(false);
  });

  it("carries the remaining hard timeout over to the background task", async () => {
    const { exec, runs } = setup();
    const result = exec({ timeout: 100 });
    const settled = expect(result).rejects.toBeInstanceOf(
      MovedToBackgroundError,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(registry.snapshot("b0001").timeoutSeconds).toBe(40);
    await vi.advanceTimersByTimeAsync(40_000);
    await vi.waitFor(() =>
      expect(registry.snapshot("b0001").status).toBe("failed"),
    );
    expect(runs[0]?.signal?.aborted).toBe(true);
  });

  it("leaves a timeout within the soft limit to the shell", async () => {
    const { exec, runs } = setup();
    void exec({ timeout: 30 }).catch(() => undefined);
    expect(runs[0]?.timeout).toBe(30);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registry.snapshots()).toHaveLength(0);
    runs[0]?.exit(0);
  });

  it("waits in the foreground when the session has no background tasks", async () => {
    const { exec, runs } = setup(() => null);
    const result = exec();
    await vi.advanceTimersByTimeAsync(120_000);
    runs[0]?.exit(0);
    await expect(result).resolves.toEqual({ exitCode: 0 });
  });

  it("keeps waiting in the foreground when the handover fails", async () => {
    const { exec, runs, output } = setup();
    const result = exec();
    await registry.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    runs[0]?.emit("late\n");
    runs[0]?.exit(0);
    await expect(result).resolves.toEqual({ exitCode: 0 });
    expect(output).toEqual(["late\n"]);
  });
});

describe("movedToBackgroundResult", () => {
  it("tells the model where the command went and how to follow it", () => {
    const task = {
      id: "b0001",
      name: "Install",
      outputPath: "/tmp/b0001.output",
    } as MovedToBackgroundError["task"];
    const withOutput = movedToBackgroundResult(
      new MovedToBackgroundError(task, "resolving"),
    ).content[0]?.text;
    expect(withOutput).toContain("background task b0001");
    expect(withOutput).toContain("resolving");
    expect(withOutput).toContain("/tmp/b0001.output");
    expect(withOutput).toContain("bg_kill");

    const silent = movedToBackgroundResult(new MovedToBackgroundError(task, ""))
      .content[0]?.text;
    expect(silent).toContain("no output so far");
  });
});
