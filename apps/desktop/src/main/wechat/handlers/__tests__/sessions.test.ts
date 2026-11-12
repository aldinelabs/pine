// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineAgentEvent } from "../../../../shared/agent";
import type { ProjectSessionSearchResult } from "../../../../shared/sessions";
import type { OutboundPush } from "../../outbound";
import { REPLY_MAX } from "../../constants";
import { WeChatRefusal } from "../../sessionDirectory";
import type { ParsedCommand } from "../../types";
import {
  createTestContext,
  summary,
  W,
  type TestContext,
} from "../../__tests__/fakes";
import { sessionHandlers } from "../sessions";

const recent = vi.hoisted(() => ({
  sessions: [] as ProjectSessionSearchResult[],
}));

vi.mock("../../../recentSessions", () => ({
  listAllRecentSessions: vi.fn(() => Promise.resolve(recent.sessions)),
  listProjectSessions: vi.fn((project: { id: string }) =>
    Promise.resolve(recent.sessions.filter((s) => s.projectId === project.id)),
  ),
  searchAllSessions: vi.fn(() => Promise.resolve(recent.sessions)),
}));

const P = "p1";
const REQ = "6a8f2d0c-3d43-4c8e-9a51-0f2a1f0c0b11";

function setup(options: Parameters<typeof createTestContext>[0] = {}) {
  const ctx = createTestContext(options);
  ctx.fake.core.addProject(P);
  ctx.fake.core.addProject("p2");
  const pushes: OutboundPush[] = [];
  vi.spyOn(ctx.outbound, "push").mockImplementation((item) => {
    pushes.push(item);
  });
  vi.spyOn(ctx.outbound, "retract").mockImplementation(() => undefined);
  recent.sessions = [];
  return { ctx, pushes, runtimes: ctx.fake.core.runtimes };
}

function cmd(
  name: ParsedCommand["name"],
  options: Partial<Omit<ParsedCommand, "kind" | "name">> = {},
): ParsedCommand {
  return { kind: "command", name, args: [], ...options };
}

async function run(
  ctx: TestContext,
  name: ParsedCommand["name"],
  options: Partial<Omit<ParsedCommand, "kind" | "name">> = {},
) {
  const handler = sessionHandlers[name];
  if (!handler) throw new Error(`no handler ${name}`);
  return handler(ctx, cmd(name, options));
}

function approval(
  sessionId: string,
  overrides: Partial<
    Extract<PineAgentEvent, { type: "approval-request" }>
  > = {},
): PineAgentEvent {
  return {
    type: "approval-request",
    sessionId,
    requestId: REQ,
    toolCallId: "tc-1",
    toolName: "bash",
    trigger: "pre-execution",
    input: { subject: "rm -rf build", description: "clean" },
    actionDigest: "digest-1",
    ...overrides,
  };
}

function running(sessionId: string): PineAgentEvent {
  return { type: "run-state", sessionId, state: "running" };
}

/** A live session the bridge holds, made current. */
async function currentSession(
  ctx: TestContext,
  sessionId = "s1",
  options: { mode?: "auto-approve" | "autonomous" | "let-me-review" } = {},
) {
  await ctx.sessions.hold(P);
  ctx.fake.core.runtimes.addLiveSession({
    sessionId,
    projectId: P,
    clientId: W,
    ...(options.mode ? { mode: options.mode } : {}),
  });
  await ctx.sessions.track(sessionId, P, "wechat");
  await ctx.sessions.setCurrent({ projectId: P, sessionId });
}

function listed(id: string, projectId = P): ProjectSessionSearchResult {
  return { ...summary(id), projectId };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe(".new", () => {
  it("starts a session with text in the current project", async () => {
    const { ctx, runtimes } = setup();
    await ctx.store.update((draft) => {
      draft.currentProjectId = P;
    });
    const result = await run(ctx, "new", { tail: "run the tests" });
    expect(ctx.fake.core.startBackgroundSession).toHaveBeenCalledWith(
      expect.objectContaining({ approvalMode: "auto-approve", ownerId: W }),
    );
    expect(result.text).toContain("Started in Project p1: run the tests");
    expect(ctx.store.get().current?.projectId).toBe(P);
    expect(runtimes.prompt).toHaveBeenCalledTimes(1);
  });

  it("does nothing without text while an ask is open (the .n guard)", async () => {
    const { ctx } = setup();
    await currentSession(ctx);
    ctx.sessions.observe(approval("s1"), undefined);
    const result = await run(ctx, "new");
    expect(result.text).toContain("To reject 11, reply .d 11");
    expect(ctx.store.get().current?.sessionId).toBe("s1");
    expect(ctx.fake.core.startBackgroundSession).not.toHaveBeenCalled();
  });

  it("without text clears the current session and arms the project", async () => {
    const { ctx } = setup();
    await currentSession(ctx);
    ctx.handles.set("project", [{ id: "p2", label: "Project p2" }]);
    ctx.handles.noteDelivered("project", ctx.now);
    const result = await run(ctx, "new", { project: "1" });
    expect(result.text).toBe(
      "Your next message starts a new session in Project p2.",
    );
    expect(ctx.store.get().current).toBeUndefined();
    expect(ctx.store.get().currentProjectId).toBe("p2");
  });

  it("refuses an attachment block before anything is prompted", async () => {
    const { ctx, runtimes } = setup();
    await expect(
      run(ctx, "new", { tail: "<pine_attachments>\n</pine_attachments>" }),
    ).rejects.toBeInstanceOf(WeChatRefusal);
    expect(runtimes.prompt).not.toHaveBeenCalled();
  });
});

describe("handles", () => {
  it("are filled by list replies only, once delivered", async () => {
    const { ctx } = setup();
    recent.sessions = [listed("a"), listed("b", "p2")];
    const result = await run(ctx, "sessions");
    expect(result.numbered).toEqual({ kind: "session" });
    expect(result.text).toContain("1 Session a · Project p1");
    expect(ctx.handles.resolve("session", 1)).toBeUndefined();
    ctx.handles.noteDelivered("session", ctx.now);
    expect(ctx.handles.resolve("session", 2)?.id).toBe("b");

    // A pushed card never changes what a number means.
    await currentSession(ctx, "s1");
    ctx.sessions.observe(approval("s1"), undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.handles.resolve("session", 1)?.id).toBe("a");
  });

  it("pages long lists for .more", async () => {
    const { ctx } = setup();
    recent.sessions = Array.from({ length: 11 }, (_, i) => listed(`x${i}`));
    await run(ctx, "sessions");
    expect(ctx.pager.remaining()).toBe(1);
    const next = ctx.pager.next();
    expect(next?.list?.rows.map((row) => row.id)).toEqual(["x8", "x9", "x10"]);
  });
});

describe(".use", () => {
  it("reports view-only with the .mode hint and never prompts", async () => {
    const { ctx, runtimes } = setup();
    await ctx.sessions.hold(P);
    runtimes.addLiveSession({
      sessionId: "hi",
      projectId: P,
      clientId: W,
      mode: "autonomous",
    });
    ctx.handles.set("session", [{ id: "hi", label: "hi", projectId: P }]);
    ctx.handles.noteDelivered("session", ctx.now);
    const result = await run(ctx, "use", { args: ["1"] });
    expect(result.text).toContain("View only");
    expect(result.text).toContain("Reply .mode 2");
    expect(runtimes.prompt).not.toHaveBeenCalled();
    expect(ctx.store.get().current?.sessionId).toBe("hi");
  });

  it("shows the card of an approval raised before the hold, with its number", async () => {
    const { ctx, runtimes } = setup();
    // Another window holds the session; the bridge only observed the event.
    runtimes.addLiveSession({ sessionId: "s9", projectId: P, clientId: 7 });
    ctx.sessions.observe(approval("s9"), 7);
    expect(ctx.asks.list()).toHaveLength(1);
    ctx.handles.set("session", [{ id: "s9", label: "s9", projectId: P }]);
    ctx.handles.noteDelivered("session", ctx.now);
    const result = await run(ctx, "use", { args: ["1"] });
    expect(result.text).toContain("Current session: Session s9");
    expect(result.text).toContain("Approval needed 11");
    expect(result.shown).toEqual([{ ask: 11, full: false }]);
    expect(ctx.store.get().tracked.map((t) => t.sessionId)).toContain("s9");
  });

  it(".u 9 is the session of the latest push", async () => {
    const { ctx } = setup();
    await currentSession(ctx, "s2");
    await ctx.store.update((draft) => {
      draft.lastPush = { sessionId: "s2", projectId: P, atMs: ctx.now };
      delete draft.current;
    });
    const result = await run(ctx, "use", { args: ["9"] });
    expect(result.text).toContain("Current session: Session s2");
    expect(ctx.store.get().current?.sessionId).toBe("s2");
  });

  it("an unknown handle is E-REF", async () => {
    const { ctx } = setup();
    const result = await run(ctx, "use", { args: ["3"] });
    expect(result.text).toBe("Number 3 is no longer valid. List again (.l).");
  });
});

describe(".last and .history", () => {
  it(".last omits tool output and reasoning and paginates", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    const long = Array.from(
      { length: 400 },
      (_, i) => `Paragraph ${i} of the reply.`,
    ).join("\n\n");
    runtimes.transcripts.set("s1", {
      hasMore: false,
      messages: [
        {
          id: "u1",
          role: "user",
          createdAt: "2026-11-12T08:00:00.000Z",
          blocks: [{ type: "text", text: "go" }],
        },
        {
          id: "a1",
          role: "assistant",
          createdAt: "2026-11-12T08:00:01.000Z",
          blocks: [
            { type: "thinking", thinking: "SECRET-THOUGHT" },
            {
              type: "toolCall",
              toolCall: {
                id: "t1",
                name: "bash",
                status: "completed",
                arguments: {},
                result: "TOOL-OUTPUT",
              } as never,
            },
            { type: "text", text: long },
          ],
        },
      ],
    });
    const result = await run(ctx, "last");
    expect(result.text).toContain("Paragraph 0 of the reply.");
    expect(result.text).not.toContain("SECRET-THOUGHT");
    expect(result.text).not.toContain("TOOL-OUTPUT");
    expect([...(result.text ?? "")].length).toBeLessThanOrEqual(REPLY_MAX);
    expect(result.text).toContain("reply .0 for the next part");
    expect(ctx.pager.remaining()).toBeGreaterThan(0);
    expect(runtimes.loadMessages.mock.calls[0]?.[0]).toBe(W);
  });

  it(".last without a reply says so", async () => {
    const { ctx } = setup();
    await currentSession(ctx);
    const result = await run(ctx, "last");
    expect(result.text).toBe("This session has no reply yet.");
  });

  it(".history lists the last turns", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    const turn = (n: number) => [
      {
        id: `u${n}`,
        role: "user" as const,
        createdAt: "2026-11-12T08:00:00.000Z",
        blocks: [{ type: "text" as const, text: `question ${n}` }],
      },
      {
        id: `a${n}`,
        role: "assistant" as const,
        createdAt: "2026-11-12T08:00:00.000Z",
        blocks: [{ type: "text" as const, text: `**answer** ${n}` }],
      },
    ];
    runtimes.transcripts.set("s1", {
      hasMore: false,
      messages: [1, 2, 3, 4].flatMap(turn),
    });
    const result = await run(ctx, "history", { args: ["2"] });
    expect(result.text).toBe(
      "You: question 3\nPine: answer 3\nYou: question 4\nPine: answer 4\n(.r for the full last reply)",
    );
    expect((await run(ctx, "history", { args: ["x"] })).text).toContain(
      "Usage: .history",
    );
  });
});

describe(".stop", () => {
  it("answers a long-context card of the current session with abort", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    ctx.sessions.observe(running("s1"), W);
    ctx.sessions.observe(
      approval("s1", { trigger: "long-context-activation" }),
      W,
    );
    const result = await run(ctx, "stop");
    expect(runtimes.respondApproval).toHaveBeenCalledWith(W, {
      requestId: REQ,
      action: "abort",
    });
    expect(runtimes.abort).not.toHaveBeenCalled();
    expect(ctx.asks.status(11)).toBe("tombstone");
    expect(result.text).toBe("Stopped: Session s1.");
  });

  it("still aborts the run when the long-context card was decided on the computer", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    ctx.sessions.observe(running("s1"), W);
    ctx.sessions.observe(
      approval("s1", { trigger: "long-context-activation" }),
      W,
    );
    runtimes.respondApproval.mockImplementationOnce(() => {
      throw new Error("This approval request is no longer pending.");
    });
    const result = await run(ctx, "stop");
    expect(runtimes.abort).toHaveBeenCalledWith(W, "s1");
    expect(ctx.asks.status(11)).toBe("tombstone");
    expect(result.text).toBe("Stopped: Session s1.");
  });

  it("aborts a running session with the actor", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    // A window shares the bridge's runtime and controls the session.
    runtimes.openProject(5, P);
    const live = runtimes.live.get("s1");
    if (live) live.controllerId = 5;
    ctx.sessions.observe(running("s1"), 5);
    const result = await run(ctx, "stop");
    expect(runtimes.abort).toHaveBeenCalledWith(5, "s1");
    expect(result.text).toBe("Stopped: Session s1.");
  });

  it(".stop and .unqueue on a session that is not live", async () => {
    const { ctx, runtimes } = setup();
    ctx.fake.core.storeSession(P, summary("old"));
    await ctx.sessions.setCurrent({ projectId: P, sessionId: "old" });
    expect((await run(ctx, "stop")).text).toBe("Nothing is running.");
    expect((await run(ctx, "unqueue")).text).toBe("No queued messages.");
    expect(runtimes.abort).not.toHaveBeenCalled();
    expect(runtimes.dequeueSteering).not.toHaveBeenCalled();
  });

  it(".stop all stops every running tracked session", async () => {
    const { ctx } = setup();
    await currentSession(ctx, "s1");
    await currentSession(ctx, "s2");
    ctx.sessions.observe(running("s1"), W);
    ctx.sessions.observe(running("s2"), W);
    const result = await run(ctx, "stop", { args: ["all"] });
    expect(result.text).toBe("Stopped 2 session(s).");
  });
});

describe(".queue, .unqueue, .rename", () => {
  it("queues text as a follow-up while running and lists the queue", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    ctx.sessions.observe(running("s1"), W);
    const result = await run(ctx, "queue", { tail: "then deploy" });
    expect(result.text).toBe("Queued. It will be sent after this turn.");
    expect(runtimes.prompt.mock.calls[0]?.[1]).toMatchObject({
      streamingBehavior: "follow-up",
      approvalMode: "auto-approve",
    });
    ctx.sessions.observe(
      { type: "steering-queue", sessionId: "s1", messages: ["then deploy"] },
      W,
    );
    const list = await run(ctx, "queue");
    expect(list.text).toContain("1 then deploy");
    ctx.handles.noteDelivered("queue", ctx.now);
    const removed = await run(ctx, "unqueue", { args: ["1"] });
    expect(runtimes.dequeueSteering).toHaveBeenCalledWith(
      W,
      "then deploy",
      "s1",
    );
    expect(removed.text).toBe("Withdrawn: then deploy");
  });

  it("renames with the actor and refuses a view-only session", async () => {
    const { ctx, runtimes } = setup();
    await currentSession(ctx);
    const result = await run(ctx, "rename", { tail: "Login fix" });
    expect(result.text).toBe("Renamed to: Login fix");
    expect(runtimes.renameSession.mock.calls[0]?.slice(0, 4)).toEqual([
      W,
      P,
      "s1",
      "Login fix",
    ]);
    await currentSession(ctx, "hi", { mode: "autonomous" });
    const refused = await run(ctx, "rename", { tail: "x" });
    expect(refused.text).toContain("above the WeChat ceiling");
  });
});

describe(".delete", () => {
  async function started(ctx: TestContext, sessionId: string) {
    await ctx.sessions.hold(P);
    ctx.fake.core.runtimes.addLiveSession({
      sessionId,
      projectId: P,
      clientId: W,
    });
    await ctx.store.update((draft) => {
      draft.origins.push({
        sessionId,
        projectId: P,
        kind: "started",
        atMs: ctx.now,
      });
    });
    ctx.handles.set("session", [
      { id: sessionId, label: sessionId, projectId: P },
    ]);
    ctx.handles.noteDelivered("session", ctx.now);
  }

  it("deletes a session live only for the bridge after confirmation", async () => {
    const { ctx, runtimes } = setup();
    await started(ctx, "d1");
    const asked = await run(ctx, "delete", { args: ["1"] });
    expect(asked.text).toContain(
      'Delete "Session d1" (Project p1, 1 messages)?',
    );
    expect(asked.text).toContain("Reply .y 11 within 2 minutes");
    expect(runtimes.deleteSession).not.toHaveBeenCalled();
    const ask = ctx.asks.get(11);
    if (ask?.kind !== "confirm") throw new Error("no confirm ask");
    const confirmedCtx = Object.assign(Object.create(ctx) as TestContext, {
      confirmed: ask,
    });
    const done = await sessionHandlers.delete?.(confirmedCtx, ask.command);
    expect(done?.text).toBe("Deleted: Session d1");
    expect(runtimes.deleteSession).toHaveBeenCalledWith(W, P, "d1");
    expect(ctx.fake.host.notifications.map((n) => n.kind)).toContain(
      "session-deleted",
    );
    expect(ctx.store.get().origins).toHaveLength(0);
  });

  it("requires a reference and never defaults to the current session", async () => {
    const { ctx } = setup();
    await currentSession(ctx);
    expect((await run(ctx, "delete")).text).toContain("Usage: .delete");
  });

  it("refuses a session not started from WeChat or only used from it", async () => {
    const { ctx } = setup();
    await currentSession(ctx, "mine");
    ctx.handles.set("session", [{ id: "mine", label: "mine", projectId: P }]);
    ctx.handles.noteDelivered("session", ctx.now);
    expect((await run(ctx, "delete", { args: ["1"] })).text).toContain(
      "Only sessions started from WeChat",
    );
    await ctx.store.update((draft) => {
      draft.origins.push({
        sessionId: "mine",
        projectId: P,
        kind: "used",
        atMs: ctx.now,
      });
    });
    expect((await run(ctx, "delete", { args: ["1"] })).text).toContain(
      "Only sessions started from WeChat",
    );
  });

  it("refuses a running session, one touched locally, and an automation run", async () => {
    const { ctx } = setup();
    await started(ctx, "d2");
    ctx.sessions.observe(running("d2"), W);
    expect((await run(ctx, "delete", { args: ["1"] })).text).toBe(
      '"Session d2" is running. Stop it with .x first.',
    );
    ctx.sessions.observe(
      { type: "run-state", sessionId: "d2", state: "idle" },
      W,
    );
    await ctx.store.update((draft) => {
      const origin = draft.origins.find((entry) => entry.sessionId === "d2");
      if (origin) origin.touchedLocally = true;
    });
    expect((await run(ctx, "delete", { args: ["1"] })).text).toContain(
      "has also been used on the computer",
    );
    await started(ctx, "d3");
    ctx.fake.core.automations.runs.set(P, new Set(["d3"]));
    expect((await run(ctx, "delete", { args: ["1"] })).text).toContain(
      "belongs to an automation run",
    );
  });
});
