// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import {
  BackgroundTaskRegistry,
  type BackgroundTaskExecutor,
} from "@pine/pi-background-tasks/registry";
import type { PineApprovalMode } from "../../shared/agent";
import type { ToolGate } from "../gate";
import {
  createBackgroundTaskToolDefinitions,
  type BackgroundTaskToolOptions,
} from "../backgroundTaskTools";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "pine-bg-tools-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function fakeGate(
  decision: { kind: "allow" } | { kind: "deny"; reason?: string } = {
    kind: "allow",
  },
) {
  return {
    reviewBashCommand: vi.fn(() => Promise.resolve(decision)),
    reviewFileCall: vi.fn(() => Promise.resolve({ kind: "allow" as const })),
    reviewDenial: vi.fn(() => Promise.resolve({ kind: "allow" as const })),
    reviewPrivilegedCall: vi.fn(() => Promise.resolve(decision)),
    isApprovedCommand: () => false,
    resetTurn: () => undefined,
  } satisfies ToolGate;
}

function setup(
  options: {
    approvalMode?: PineApprovalMode;
    gate?: ToolGate | null;
    sandboxAvailable?: boolean;
  } = {},
) {
  const executions: Array<{ privileged: boolean; command: string }> = [];
  const executor = (privileged: boolean): BackgroundTaskExecutor => ({
    exec: (command, _cwd, run) => {
      executions.push({ privileged, command });
      // The command keeps running until it is aborted.
      return new Promise((_resolve, reject) => {
        run.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
        run.onData(Buffer.from("started\n"));
      });
    },
  });
  const registry = new BackgroundTaskRegistry({
    cwd: "/project",
    outputDirectory: path.join(directory, "tasks"),
    executor,
    stopWaitMs: 500,
    logger: { error: vi.fn() },
  });
  const gate = options.gate === undefined ? fakeGate() : options.gate;
  const toolOptions: BackgroundTaskToolOptions = {
    registry,
    getApprovalMode: () => options.approvalMode ?? "auto-approve",
    getGate: () => gate,
    sandboxAvailable: options.sandboxAvailable ?? true,
    shellName: "bash",
  };
  const tools = createBackgroundTaskToolDefinitions(toolOptions);
  const byName = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  };
  const call = async (name: string, params: unknown, signal?: AbortSignal) => {
    const result = await byName(name).execute(
      "call-1",
      params,
      signal,
      undefined,
      {} as ExtensionToolContext,
    );
    return {
      text: (result.content[0] as { text: string }).text,
      details: result.details as Record<string, unknown>,
    };
  };
  return { registry, gate, executions, tools, call };
}

describe("tool set", () => {
  it("offers the four upstream tools", () => {
    expect(setup().tools.map((tool) => tool.name)).toEqual([
      "bg_run",
      "bg_status",
      "bg_logs",
      "bg_kill",
    ]);
  });

  it("explains the sandbox and the privileged escape hatch to the model", () => {
    const run = setup().tools[0];
    expect(run?.description).toContain("project sandbox");
    expect(run?.description).toContain("privileged:true");
  });

  it("states that every task is native where the sandbox is unavailable", () => {
    const run = setup({ sandboxAvailable: false }).tools[0];
    expect(run?.description).toContain("native permissions");
    expect(run?.description).not.toContain("privileged:true");
  });
});

describe("bg_run", () => {
  it("starts a sandboxed task without review in auto-approve mode", async () => {
    const { call, executions, gate } = setup();
    const result = await call("bg_run", {
      name: "Dev server",
      command: "bun run dev",
    });
    expect(executions).toEqual([{ privileged: false, command: "bun run dev" }]);
    expect(gate?.reviewPrivilegedCall).not.toHaveBeenCalled();
    expect(gate?.reviewBashCommand).not.toHaveBeenCalled();
    expect(result.text).toContain("Started background task Dev server (");
    expect(result.text).toContain("Permissions: project sandbox");
    expect(result.text).toContain("Automatic follow-up turn: enabled.");
    expect(result.details).toMatchObject({
      task: { name: "Dev server", status: "running", privileged: false },
    });
  });

  it("wakes the agent by default, and not when told otherwise", async () => {
    const { call } = setup();
    expect(
      (
        (await call("bg_run", { name: "A", command: "a" })).details as {
          task: { triggerOnCompletion: boolean };
        }
      ).task.triggerOnCompletion,
    ).toBe(true);
    const quiet = await call("bg_run", {
      name: "B",
      command: "b",
      triggerOnCompletion: false,
    });
    expect(quiet.text).toContain("Automatic follow-up turn: disabled.");
  });

  it("reviews every command in Let Me Review mode", async () => {
    const { call, gate } = setup({ approvalMode: "let-me-review" });
    await call("bg_run", { name: "Build", command: "make" });
    expect(gate?.reviewBashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "bg_run",
        command: "make",
        description: "Build",
      }),
    );
  });

  it("does not start a task the reviewer denied", async () => {
    const { call, executions, registry } = setup({
      approvalMode: "let-me-review",
      gate: fakeGate({ kind: "deny", reason: "No servers today." }),
    });
    await expect(
      call("bg_run", { name: "Build", command: "make" }),
    ).rejects.toThrow("No servers today.");
    expect(executions).toHaveLength(0);
    expect(registry.snapshots()).toHaveLength(0);
  });

  it("runs privileged tasks natively, after review", async () => {
    const { call, executions, gate } = setup();
    const result = await call("bg_run", {
      name: "Local server",
      command: "python -m http.server",
      privileged: true,
    });
    expect(gate?.reviewPrivilegedCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "bg_run",
        subject: "python -m http.server",
        description: "Local server",
      }),
    );
    expect(executions).toEqual([
      { privileged: true, command: "python -m http.server" },
    ]);
    expect(result.text).toContain("Permissions: native");
  });

  it("does not start a privileged task the reviewer denied", async () => {
    const { call, executions } = setup({
      gate: fakeGate({ kind: "deny", reason: "Not on my machine." }),
    });
    await expect(
      call("bg_run", { name: "S", command: "serve", privileged: true }),
    ).rejects.toThrow(
      "Approval denied before execution; the background task was not started. Not on my machine.",
    );
    expect(executions).toHaveLength(0);
  });

  it("needs a gate for privileged tasks outside YOLO mode", async () => {
    const { call } = setup({ gate: null });
    await expect(
      call("bg_run", { name: "S", command: "serve", privileged: true }),
    ).rejects.toThrow("without an approval gate");
  });

  it("runs everything natively in YOLO mode without review", async () => {
    const { call, executions, gate } = setup({ approvalMode: "YOLO" });
    await call("bg_run", { name: "S", command: "serve" });
    expect(executions).toEqual([{ privileged: true, command: "serve" }]);
    expect(gate?.reviewPrivilegedCall).not.toHaveBeenCalled();
  });

  it("reviews every task as native where there is no sandbox", async () => {
    const { call, executions, gate } = setup({ sandboxAvailable: false });
    await call("bg_run", { name: "S", command: "serve" });
    expect(gate?.reviewPrivilegedCall).toHaveBeenCalledTimes(1);
    expect(executions).toEqual([{ privileged: true, command: "serve" }]);
  });

  it("does not start when the call was aborted during review", async () => {
    const controller = new AbortController();
    const gate = fakeGate();
    gate.reviewPrivilegedCall.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ kind: "allow" as const });
    });
    const { call, executions } = setup({ gate });
    await expect(
      call(
        "bg_run",
        { name: "S", command: "serve", privileged: true },
        controller.signal,
      ),
    ).rejects.toThrow("aborted");
    expect(executions).toHaveLength(0);
  });
});

describe("bg_status, bg_logs, bg_kill", () => {
  it("lists every task, or one by id prefix", async () => {
    const { call } = setup();
    await call("bg_run", { name: "First", command: "a" });
    await call("bg_run", { name: "Second", command: "b" });
    const all = await call("bg_status", {});
    expect(all.text).toContain("First");
    expect(all.text).toContain("Second");
    const id = (all.details.tasks as Array<{ id: string }>)[1]?.id ?? "";
    const one = await call("bg_status", { taskId: id.slice(0, 4) });
    expect(one.details.tasks).toHaveLength(1);
    await expect(call("bg_status", { taskId: "zzzz" })).rejects.toThrow(
      "Unknown background task ID",
    );
  });

  it("reads bounded logs with a pointer to the full file", async () => {
    const { call } = setup();
    const started = await call("bg_run", { name: "Log", command: "a" });
    const id = (started.details.task as { id: string }).id;
    await vi.waitFor(async () => {
      expect((await call("bg_logs", { taskId: id })).text).toContain("started");
    });
    const logs = await call("bg_logs", {
      taskId: id,
      maxBytes: 3,
      tail: false,
    });
    expect(logs.text).toContain("sta");
    expect(logs.text).toContain("Showing head 3B");
    expect(logs.details).toMatchObject({ truncated: true, tail: false });
  });

  it("kills a running task and rejects a finished one", async () => {
    const { call } = setup();
    const started = await call("bg_run", { name: "Stoppable", command: "a" });
    const id = (started.details.task as { id: string }).id;
    const killed = await call("bg_kill", { taskId: id });
    expect(killed.text).toContain("Killed Stoppable");
    expect(killed.details).toMatchObject({ task: { status: "killed" } });
    await expect(call("bg_kill", { taskId: id })).rejects.toThrow(
      "killed, not running",
    );
  });
});
