// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParsedCommand } from "../../types";
import { createTestContext, W, type TestContext } from "../../__tests__/fakes";
import { metaHandlers } from "../meta";

const P = "p1";

function setup(options: Parameters<typeof createTestContext>[0] = {}) {
  const ctx = createTestContext(options);
  ctx.fake.core.addProject(P);
  vi.spyOn(ctx.outbound, "push").mockImplementation(() => undefined);
  vi.spyOn(ctx.outbound, "retract").mockImplementation(() => false);
  return { ctx, runtimes: ctx.fake.core.runtimes };
}

async function run(
  ctx: TestContext,
  name: ParsedCommand["name"],
  args: string[] = [],
) {
  const handler = metaHandlers[name];
  if (!handler) throw new Error(`no handler ${name}`);
  return handler(ctx, { kind: "command", name, args });
}

async function liveTracked(ctx: TestContext, sessionId: string) {
  await ctx.sessions.hold(P);
  ctx.fake.core.runtimes.addLiveSession({
    sessionId,
    projectId: P,
    clientId: W,
  });
  await ctx.sessions.track(sessionId, P, "wechat");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(".help", () => {
  it("lists the hot path, the rest, and one command", async () => {
    const { ctx } = setup();
    expect((await run(ctx, "help")).text).toContain(
      "Computer: Test Mac · Highest mode: Auto Approve · Files: off",
    );
    expect((await run(ctx, "help", ["2"])).text).toContain("| `.m` | model |");
    expect((await run(ctx, "help", ["n"])).text).toContain(
      ".new [@project] [text]",
    );
    expect((await run(ctx, "help", ["nope"])).text).toContain(
      "There is no `.nope` command.",
    );
  });
});

describe(".help recall", () => {
  it("shows the .unqueue usage with .recall among the aliases", async () => {
    const { ctx } = setup();
    const text = (await run(ctx, "help", ["recall"])).text ?? "";
    expect(text).toContain(".unqueue");
    expect(text).toContain("`.qx` `.recall` `.撤回`");
  });
});

describe(".info", () => {
  it("never shows a path or the token", async () => {
    const { ctx } = setup();
    const text = (await run(ctx, "info")).text ?? "";
    expect(text).toContain("**Test Mac** · Pine 1.4.2");
    expect(text).toContain("High-risk approvals: computer only · Files: off");
    expect(text).not.toContain("fake-token");
    expect(text).not.toContain("/fake");
    expect(text).not.toContain("owner@im.wechat");
  });
});

describe(".lang", () => {
  it("sets the reply language in the bridge state only", async () => {
    const { ctx } = setup();
    const secureWrites = ctx.fake.store.writes.secure;
    expect((await run(ctx, "lang", ["zh"])).text).toBe("回复语言：中文");
    expect(ctx.store.get().language).toBe("zh");
    expect(ctx.fake.store.writes.secure).toBe(secureWrites);
    expect((await run(ctx, "lang", ["fr"])).text).toContain("Usage: `.lang");
  });
});

describe(".pause", () => {
  it("pauses and notifies locally", async () => {
    const { ctx, runtimes } = setup();
    await liveTracked(ctx, "s1");
    ctx.sessions.observe(
      { type: "run-state", sessionId: "s1", state: "running" },
      W,
    );
    const result = await run(ctx, "pause");
    expect(ctx.fake.pause).toHaveBeenCalledTimes(1);
    expect(runtimes.abort).not.toHaveBeenCalled();
    expect(result.text).toBe(
      "WeChat remote is paused. It can only be resumed on the computer.\n1 session(s) are still running; stop them on the computer.",
    );
    expect(ctx.fake.host.notifications.map((n) => n.kind)).toEqual(["paused"]);
  });

  it(".pause all aborts the running tracked sessions first", async () => {
    const { ctx, runtimes } = setup();
    await liveTracked(ctx, "s1");
    await liveTracked(ctx, "s2");
    ctx.sessions.observe(
      { type: "run-state", sessionId: "s1", state: "running" },
      W,
    );
    const order: string[] = [];
    runtimes.abort.mockImplementation((clientId: number, sessionId: string) => {
      order.push(`abort:${clientId}:${sessionId}`);
      return Promise.resolve({ aborted: true, sessionId });
    });
    ctx.fake.pause.mockImplementation(() => {
      order.push("pause");
    });
    const result = await run(ctx, "pause", ["all"]);
    expect(order).toEqual([`abort:${W}:s1`, "pause"]);
    expect(result.text).toBe(
      "Stopped 1 session(s) and paused WeChat remote. It can only be resumed on the computer.",
    );
  });

  it("refuses an unknown parameter", async () => {
    const { ctx } = setup();
    expect((await run(ctx, "pause", ["now"])).text).toContain("Usage: `.pause");
    expect(ctx.fake.pause).not.toHaveBeenCalled();
  });
});

describe(".status", () => {
  it("without a current session names the project and the default mode", async () => {
    const { ctx } = setup();
    expect((await run(ctx, "status")).text).toBe(
      "No current session. Project **No Project** · Default mode: Auto Approve\n\n> Send text to start one, or `.l` to pick a session.",
    );
  });

  it("shows the current session and fills the session table with the others", async () => {
    const { ctx } = setup();
    await liveTracked(ctx, "s1");
    await liveTracked(ctx, "s2");
    await ctx.sessions.setCurrent({ projectId: P, sessionId: "s1" });
    ctx.sessions.observe(
      { type: "run-state", sessionId: "s2", state: "running" },
      W,
    );
    const result = await run(ctx, "status");
    expect(result.text).toContain("**Project p1 › Session s1** · Idle");
    expect(result.text).toContain(
      "| `.1` | Session s2 · Project p1 | ▶ Running |",
    );
    expect(result.numbered).toEqual({ kind: "session" });
    ctx.handles.noteDelivered("session", ctx.now);
    expect(ctx.handles.resolve("session", 1)?.id).toBe("s2");
  });
});

describe(".more and .drop", () => {
  it(".more sends the next page and installs its list", async () => {
    const { ctx } = setup();
    expect((await run(ctx, "more")).text).toBe("Nothing more.");
    ctx.pager.set([
      {
        text: "page 2",
        list: { kind: "session", rows: [{ id: "z", label: "z" }] },
      },
    ]);
    const result = await run(ctx, "more");
    expect(result).toEqual({ text: "page 2", numbered: { kind: "session" } });
    ctx.handles.noteDelivered("session", ctx.now);
    expect(ctx.handles.resolve("session", 1)?.id).toBe("z");
  });

  it(".drop discards pending attachments", async () => {
    const { ctx } = setup();
    ctx.fake.attachments.add("a.png");
    ctx.fake.attachments.add("b.pdf");
    expect((await run(ctx, "drop")).text).toBe("Dropped 2 attachment(s).");
  });
});
