// @vitest-environment node
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { describe, expect, it, type Mock } from "vitest";
import { TASK_OUTPUT_LINES, TASK_OUTPUT_MAX } from "../../constants";
import { render } from "../../replies";
import type { ParsedCommand } from "../../types";
import { createTestContext, W, type TestContext } from "../../__tests__/fakes";
import { taskHandlers } from "../tasks";

function run(
  name: "tasks" | "task" | "kill",
  ctx: TestContext,
  ...args: string[]
) {
  const handler = taskHandlers[name];
  if (!handler) throw new Error(`no handler for ${name}`);
  const parsed: ParsedCommand = { kind: "command", name, args };
  return handler(ctx, parsed);
}

function snapshot(
  id: string,
  overrides: Partial<BackgroundTaskSnapshot> = {},
): BackgroundTaskSnapshot {
  return {
    id,
    name: `task ${id}`,
    command: "npm run dev",
    status: "running",
    outputPath: `/fake/out/${id}.log`,
    cwd: "/fake/projects/p1",
    startTime: Date.UTC(2026, 10, 12, 7, 50),
    bytesWritten: 0,
    notified: false,
    notifyOnCompletion: false,
    triggerOnCompletion: false,
    privileged: false,
    ...overrides,
  };
}

async function setup(options: { live?: boolean } = {}): Promise<TestContext> {
  const ctx = createTestContext();
  ctx.fake.core.addProject("p1");
  if (options.live ?? true)
    ctx.fake.core.runtimes.addLiveSession({
      sessionId: "s1",
      projectId: "p1",
      clientId: W,
    });
  await ctx.store.update((draft) => {
    draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: ctx.now };
  });
  return ctx;
}

/** The runtimes fake's background-task methods, as plain mocks. */
function mocks(ctx: TestContext) {
  const runtimes = ctx.fake.core.runtimes;
  return {
    list: runtimes.listBackgroundTasks as unknown as Mock,
    read: runtimes.readBackgroundTaskOutput as unknown as Mock,
    stop: runtimes.stopBackgroundTask as unknown as Mock,
  };
}

function setTasks(ctx: TestContext, tasks: BackgroundTaskSnapshot[]): void {
  mocks(ctx).list.mockResolvedValue({ tasks });
}

describe(".tasks", () => {
  it("lists processes with the command line cut to 60 code points", async () => {
    const ctx = await setup();
    const long = `node ${"x".repeat(100)}`;
    setTasks(ctx, [
      snapshot("a", { command: long }),
      snapshot("b", { status: "completed", exitCode: 0 }),
    ]);
    const result = await run("tasks", ctx);
    expect(result.numbered).toEqual({ kind: "task" });
    const first = result.text?.split("\n")[0] ?? "";
    expect(first).toContain("1 task a · running 10");
    expect(first).not.toContain("x".repeat(60));
    expect(result.text).toContain("2 task b · exited 0");
    expect(ctx.fake.core.runtimes.listBackgroundTasks).toHaveBeenCalledWith(
      W,
      "s1",
    );
  });

  it("puts more than eight processes behind .more", async () => {
    const ctx = await setup();
    setTasks(
      ctx,
      Array.from({ length: 10 }, (_, i) => snapshot(`t${i}`)),
    );
    const result = await run("tasks", ctx);
    expect(result.text).toContain("(1/2, reply .0 for the next part)");
    expect(ctx.pager.remaining()).toBe(1);
    expect(ctx.pager.next()?.list?.rows.map((row) => row.id)).toEqual([
      "t8",
      "t9",
    ]);
  });

  it("is the empty list for a session that is not live, without calling the runtime", async () => {
    const ctx = await setup({ live: false });
    expect((await run("tasks", ctx)).text).toBe(
      render("R-TASKS", "en", { rows: [] }),
    );
    expect((await run("task", ctx, "1")).text).toBe(
      render("R-TASKS", "en", { rows: [] }),
    );
    expect((await run("kill", ctx, "1")).text).toBe(
      render("R-TASKS", "en", { rows: [] }),
    );
    const runtimes = ctx.fake.core.runtimes;
    expect(runtimes.listBackgroundTasks).not.toHaveBeenCalled();
    expect(runtimes.readBackgroundTaskOutput).not.toHaveBeenCalled();
    expect(runtimes.stopBackgroundTask).not.toHaveBeenCalled();
  });

  it("needs a current session", async () => {
    const ctx = createTestContext();
    expect((await run("tasks", ctx)).text).toBe(render("E-NOSESSION", "en"));
  });
});

describe(".task", () => {
  it("shows the tail and offers .more at most three times", async () => {
    const ctx = await setup();
    setTasks(ctx, [snapshot("a")]);
    await run("tasks", ctx);
    ctx.handles.noteDelivered("task", ctx.now);
    const content = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    mocks(ctx).read.mockResolvedValue({
      content,
      bytesRead: content.length,
      totalBytes: content.length,
      truncated: false,
    });
    const result = await run("task", ctx, "1");
    expect(
      ctx.fake.core.runtimes.readBackgroundTaskOutput,
    ).toHaveBeenCalledWith(W, { sessionId: "s1", taskId: "a" });
    const text = result.text ?? "";
    expect(text).toContain("line 999");
    expect(text).not.toContain("line 959\n");
    const outputLines = text
      .split("\n")
      .filter((line) => line.startsWith("line "));
    expect(outputLines.length).toBeLessThanOrEqual(TASK_OUTPUT_LINES);
    expect(ctx.pager.remaining()).toBe(3);
    const pages = [ctx.pager.next(), ctx.pager.next(), ctx.pager.next()];
    expect(ctx.pager.next()).toBeUndefined();
    expect(pages[0]?.text).toContain("line 959");
    expect(pages[2]?.text).toContain("(Open Pine for the full text)");
  });

  it("caps one block at the code-point limit", async () => {
    const ctx = await setup();
    setTasks(ctx, [snapshot("a")]);
    await run("tasks", ctx);
    ctx.handles.noteDelivered("task", ctx.now);
    const content = "y".repeat(TASK_OUTPUT_MAX * 2);
    mocks(ctx).read.mockResolvedValue({
      content,
      bytesRead: content.length,
      totalBytes: content.length,
      truncated: false,
    });
    const text = (await run("task", ctx, "1")).text ?? "";
    const body = text.split("\n")[1] ?? "";
    expect(Array.from(body).length).toBe(TASK_OUTPUT_MAX);
    expect(ctx.pager.remaining()).toBe(1);
  });

  it("answers E-REF without a delivered list", async () => {
    const ctx = await setup();
    expect((await run("task", ctx, "1")).text).toBe(
      render("E-REF", "en", { n: "1", list: ".b" }),
    );
  });
});

describe(".kill", () => {
  it("stops the process of the row through the actor", async () => {
    const ctx = await setup();
    setTasks(ctx, [snapshot("a")]);
    await run("tasks", ctx);
    ctx.handles.noteDelivered("task", ctx.now);
    mocks(ctx).stop.mockResolvedValue({
      task: snapshot("a", { status: "killed" }),
    });
    const result = await run("kill", ctx, "1");
    expect(result.text).toBe(render("R-KILLED", "en", { title: "task a" }));
    expect(ctx.fake.core.runtimes.stopBackgroundTask).toHaveBeenCalledWith(W, {
      sessionId: "s1",
      taskId: "a",
    });
  });

  it("refuses a table of another session", async () => {
    const ctx = await setup();
    setTasks(ctx, [snapshot("a")]);
    await run("tasks", ctx);
    ctx.handles.noteDelivered("task", ctx.now);
    ctx.fake.core.runtimes.addLiveSession({
      sessionId: "s2",
      projectId: "p1",
      clientId: W,
    });
    await ctx.store.update((draft) => {
      draft.current = { projectId: "p1", sessionId: "s2", usedAtMs: ctx.now };
    });
    expect((await run("kill", ctx, "1")).text).toBe(
      render("E-REF", "en", { n: "1", list: ".b" }),
    );
    expect(ctx.fake.core.runtimes.stopBackgroundTask).not.toHaveBeenCalled();
  });

  it("needs a number", async () => {
    const ctx = await setup();
    expect((await run("kill", ctx)).text).toContain("Usage: .kill");
  });
});
