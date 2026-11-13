// @vitest-environment node
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineAgentEvent } from "../../../../shared/agent";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { BARE_GAP_MS, CURRENT_IDLE_ACK_MS } from "../../constants";
import { createTestContext, W, type TestContext } from "../../__tests__/fakes";
import { handleNumber, handlePlainMessage } from "../message";

const P = "p1";
const REQ = "1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8";

const questionnaire: AskUserQuestionParams = {
  questions: [
    {
      question: "Which login?",
      header: "Login",
      options: [
        { label: "Email code", description: "" },
        { label: "Password", description: "" },
      ],
    },
  ],
};

function setup(options: Parameters<typeof createTestContext>[0] = {}) {
  const ctx = createTestContext(options);
  ctx.fake.core.addProject(P);
  ctx.fake.core.addProject("p2");
  vi.spyOn(ctx.outbound, "push").mockImplementation(() => undefined);
  vi.spyOn(ctx.outbound, "retract").mockImplementation(() => false);
  return { ctx, runtimes: ctx.fake.core.runtimes };
}

async function tracked(
  ctx: TestContext,
  sessionId: string,
  options: { current?: boolean } = {},
) {
  await ctx.sessions.hold(P);
  ctx.fake.core.runtimes.addLiveSession({
    sessionId,
    projectId: P,
    clientId: W,
  });
  await ctx.sessions.track(sessionId, P, "wechat");
  if (options.current)
    await ctx.sessions.setCurrent({ projectId: P, sessionId });
}

function running(sessionId: string): PineAgentEvent {
  return { type: "run-state", sessionId, state: "running" };
}

function approval(
  ctx: TestContext,
  sessionId: string,
  trigger: "pre-execution" | "privileged-execution" = "pre-execution",
): void {
  ctx.sessions.observe(
    {
      type: "approval-request",
      sessionId,
      requestId: REQ,
      toolCallId: "tc",
      toolName: "bash",
      trigger,
      input: { subject: "make" },
    },
    W,
  );
}

function question(
  ctx: TestContext,
  sessionId: string,
  requestId = REQ,
  params: AskUserQuestionParams = questionnaire,
): void {
  ctx.sessions.observe(
    {
      type: "questionnaire-request",
      sessionId,
      requestId,
      toolCallId: "tq",
      questionnaire: params,
    },
    W,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("plain text routing (CMD §3.2, §3.3, ground rule 14)", () => {
  it("starts a session when there is no current session", async () => {
    const { ctx } = setup();
    ctx.fake.core.addProject(TEMPORARY_WORKSPACE_PROJECT_ID);
    const result = await handlePlainMessage(ctx, "fix the login page");
    expect(result.text).toContain(
      "**No Project** · Started: fix the login page",
    );
    expect(ctx.fake.core.startBackgroundSession).toHaveBeenCalledTimes(1);
  });

  it("is silent when unambiguous, with an explicit mode on the prompt", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    const result = await handlePlainMessage(ctx, "and the footer");
    expect(result).toEqual({});
    expect(runtimes.prompt).toHaveBeenCalledWith(
      W,
      expect.objectContaining({
        target: { kind: "session", projectId: P, sessionId: "s1" },
        approvalMode: "auto-approve",
      }),
      { focus: false },
    );
    expect(runtimes.prompt.mock.calls[0]?.[1]).not.toHaveProperty(
      "streamingBehavior",
    );
  });

  it("acknowledges with R-ROUTE when the current session is older than 2 h", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.fake.clock.advance(CURRENT_IDLE_ACK_MS + 1);
    const result = await handlePlainMessage(ctx, "still there?");
    expect(result.text).toBe(
      "→ **Project p1 › Session s1** · `.n` starts a new one",
    );
    expect(runtimes.prompt).toHaveBeenCalledTimes(1);
  });

  it("acknowledges when two tracked sessions run", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    await tracked(ctx, "s2");
    await tracked(ctx, "s3");
    ctx.sessions.observe(running("s2"), W);
    ctx.sessions.observe(running("s3"), W);
    const result = await handlePlainMessage(ctx, "hello");
    expect(result.text).toContain("→ **Project p1 › Session s1**");
  });

  it("after a push about another session the text still goes to current, with R-ROUTE", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    await tracked(ctx, "s2");
    await ctx.store.update((draft) => {
      draft.lastAcceptedAtMs = ctx.now - 1000;
      draft.lastPush = { sessionId: "s2", projectId: P, atMs: ctx.now };
    });
    const result = await handlePlainMessage(ctx, "ok do it");
    expect(result.text).toContain("Session s1");
    expect(runtimes.prompt.mock.calls[0]?.[1].target).toEqual({
      kind: "session",
      projectId: P,
      sessionId: "s1",
    });
    expect(ctx.asks.list()).toHaveLength(0);
  });

  it("steers a running session", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.sessions.observe(running("s1"), W);
    const result = await handlePlainMessage(ctx, "use pnpm");
    expect(result.text).toBe(
      "**Project p1 › Session s1** · Passed to the running task.",
    );
    expect(runtimes.prompt.mock.calls[0]?.[1]).toMatchObject({
      streamingBehavior: "steer",
      approvalMode: "auto-approve",
    });
  });

  it("queues plain text as steering while an approval card is open", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.sessions.observe(running("s1"), W);
    approval(ctx, "s1");
    const result = await handlePlainMessage(ctx, "go on");
    expect(runtimes.prompt).toHaveBeenCalledTimes(1);
    expect(runtimes.prompt.mock.calls[0]?.[1]).toMatchObject({
      streamingBehavior: "steer",
      approvalMode: "auto-approve",
    });
    expect(result.text).toBe(
      [
        "**Project p1 › Session s1** · Staged as a steering message",
        "",
        "It reaches the agent once the waiting card is handled.",
        "",
        "**Still waiting**",
        "- **11** approval · `.y 11` approves · `.d 11` rejects",
        "",
        "> `.recall` withdraws this message",
      ].join("\n"),
    );
    expect(ctx.asks.status(11)).toBe("open");
  });

  it("drops the card list when the card closes while the text is sent", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.sessions.observe(running("s1"), W);
    approval(ctx, "s1");
    const send = ctx.sessions.send.bind(ctx.sessions);
    vi.spyOn(ctx.sessions, "send").mockImplementation(async (input) => {
      ctx.asks.closeWhere((ask) => ask.kind === "approval", "invalidated");
      return send(input);
    });
    const result = await handlePlainMessage(ctx, "go on");
    expect(result.text).toBe(
      "**Project p1 › Session s1** · Passed to the running task.",
    );
  });

  it("does not claim a waiting card when the run ends while the text is sent", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.sessions.observe(running("s1"), W);
    approval(ctx, "s1");
    const send = ctx.sessions.send.bind(ctx.sessions);
    vi.spyOn(ctx.sessions, "send").mockImplementation(async (input) => {
      ctx.sessions.observe(
        { type: "run-state", sessionId: "s1", state: "idle" },
        W,
      );
      ctx.asks.closeWhere((ask) => ask.kind === "approval", "invalidated");
      return send(input);
    });
    const result = await handlePlainMessage(ctx, "go on");
    expect(result.text ?? "").not.toContain("Staged as a steering message");
    expect(result.text ?? "").not.toContain("Passed to the running task");
  });

  it("names how to answer an open question card", async () => {
    const { ctx, runtimes } = setup();
    await tracked(ctx, "s1", { current: true });
    question(ctx, "s1");
    const result = await handlePlainMessage(ctx, "email");
    expect(runtimes.prompt.mock.calls[0]?.[1]).toMatchObject({
      streamingBehavior: "steer",
    });
    expect(result.text).toContain(
      "**11** question · `.a 11 your answer` · `.d 11` cancels",
    );
  });

  it("does not offer .a for a question that must be answered in Pine", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    const rich: AskUserQuestionParams = {
      questions: [
        {
          question: "Which layout?",
          header: "Layout",
          options: [
            { label: "Grid", description: "", preview: "<grid/>" },
            { label: "List", description: "" },
          ],
        },
      ],
    };
    question(ctx, "s1", REQ, rich);
    const result = await handlePlainMessage(ctx, "either is fine");
    expect(result.text).toContain(
      "**11** question · answer it in Pine · `.d 11` cancels",
    );
    expect(result.text).not.toContain(".a 11");
  });

  it("names every open card of the session", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    approval(ctx, "s1");
    question(ctx, "s1", "2b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8");
    const result = await handlePlainMessage(ctx, "also this");
    expect(result.text).toContain("**11** approval · `.y 11` approves");
    expect(result.text).toContain("**12** question · `.a 12 your answer`");
  });

  it("uses the display-only wording for a high-risk card", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    approval(ctx, "s1", "privileged-execution");
    const result = await handlePlainMessage(ctx, "go on");
    expect(result.text).toContain(
      "**11** approve on the computer · `.d 11` rejects",
    );
  });

  it("answers in Chinese", async () => {
    const { ctx } = setup({ lang: "zh" });
    await tracked(ctx, "s1", { current: true });
    approval(ctx, "s1");
    const result = await handlePlainMessage(ctx, "继续");
    expect(result.text).toContain("已作为暂存消息排队");
    expect(result.text).toContain("**11** 审批 · `.y 11` 批准 · `.d 11` 拒绝");
    expect(result.text).toContain(".撤回");
  });

  it("carries the quote and staged attachments into the queued message", async () => {
    const { ctx, runtimes } = setup({ inbound: { quotedText: "earlier" } });
    await tracked(ctx, "s1", { current: true });
    approval(ctx, "s1");
    ctx.fake.attachments.add("a.png");
    await handlePlainMessage(ctx, "look at this");
    const request = runtimes.prompt.mock.calls[0]?.[1];
    expect(request).toMatchObject({ streamingBehavior: "steer" });
    expect(request?.message).toContain("look at this");
    expect(request?.message).toContain("earlier");
    expect(request?.message).toContain("a.png");
  });

  it("refuses a view-only session with an open card", async () => {
    const { ctx, runtimes } = setup();
    await ctx.sessions.hold(P);
    runtimes.addLiveSession({
      sessionId: "hi",
      projectId: P,
      clientId: W,
      mode: "autonomous",
    });
    await ctx.sessions.setCurrent({ projectId: P, sessionId: "hi" });
    approval(ctx, "hi");
    expect(ctx.sessions.asksOf("hi")).toHaveLength(1);
    await expect(handlePlainMessage(ctx, "go")).rejects.toMatchObject({
      id: "E-VIEW",
    });
    expect(runtimes.prompt).not.toHaveBeenCalled();
  });

  it("refuses a view-only session", async () => {
    const { ctx, runtimes } = setup();
    await ctx.sessions.hold(P);
    runtimes.addLiveSession({
      sessionId: "hi",
      projectId: P,
      clientId: W,
      mode: "autonomous",
    });
    await ctx.sessions.setCurrent({ projectId: P, sessionId: "hi" });
    await expect(handlePlainMessage(ctx, "go")).rejects.toMatchObject({
      id: "E-VIEW",
    });
    expect(runtimes.prompt).not.toHaveBeenCalled();
  });

  it("drops a held batch", async () => {
    const { ctx } = setup();
    await tracked(ctx, "s1", { current: true });
    ctx.asks.open({ kind: "held", reason: "stale", items: [] });
    await handlePlainMessage(ctx, "new thought");
    expect(ctx.asks.list()).toHaveLength(0);
  });
});

describe("bare numbers (CMD §4.3)", () => {
  it("maps .0, .9 and .NN, and refuses .10", async () => {
    const { ctx } = setup();
    await handleNumber(ctx, [0]);
    await handleNumber(ctx, [9]);
    await handleNumber(ctx, [14]);
    expect(ctx.fake.dispatch.mock.calls.map((call) => call[0])).toEqual([
      { kind: "command", name: "more", args: [] },
      { kind: "command", name: "use", args: ["9"] },
      { kind: "command", name: "show", args: ["14"] },
    ]);
    expect((await handleNumber(ctx, [10])).text).toBe(
      "Number 10 is no longer valid. List again (`.l`).",
    );
  });

  it("picks a row of the last delivered list", async () => {
    const { ctx } = setup();
    expect((await handleNumber(ctx, [2])).text).toContain(
      "Number 2 is no longer valid",
    );
    ctx.handles.set("session", [
      { id: "a", label: "a", projectId: P },
      { id: "b", label: "b", projectId: P },
    ]);
    ctx.handles.noteDelivered("session", ctx.now);
    await handleNumber(ctx, [2]);
    expect(ctx.fake.dispatch).toHaveBeenCalledWith({
      kind: "command",
      name: "use",
      args: ["2"],
    });
  });

  it("never withdraws a queued message", async () => {
    const { ctx } = setup();
    ctx.handles.set("queue", [{ id: "x", label: "x" }], "s1");
    ctx.handles.noteDelivered("queue", ctx.now);
    expect((await handleNumber(ctx, [1])).text).toContain("Usage: `.unqueue");
    expect(ctx.fake.dispatch).not.toHaveBeenCalled();
  });

  it("a number list outside a question card is E-ARGS", async () => {
    const { ctx } = setup();
    expect((await handleNumber(ctx, [1, 3])).text).toContain("Usage: `.answer");
  });

  describe("after a pushed question card", () => {
    async function card(ctx: TestContext) {
      await tracked(ctx, "s1", { current: true });
      // A list was delivered before the card.
      ctx.handles.set("session", [
        { id: "a", label: "a", projectId: P },
        { id: "b", label: "b", projectId: P },
      ]);
      ctx.handles.noteDelivered("session", ctx.now - 60_000);
      ctx.sessions.observe(
        {
          type: "questionnaire-request",
          sessionId: "s1",
          requestId: REQ,
          toolCallId: "tc",
          questionnaire,
        },
        W,
      );
      ctx.asks.markDelivered(11, ctx.now);
    }

    it("within the gap is E-AMBIG and does nothing", async () => {
      const { ctx } = setup({
        inbound: { createdAtMs: 0, pollStartedAtMs: 0 },
      });
      await card(ctx);
      const within = Object.assign(Object.create(ctx) as TestContext, {
        inbound: {
          id: "m",
          createdAtMs: ctx.now + 1000,
          pollStartedAtMs: ctx.now + 1000,
        },
      });
      const result = await handleNumber(within, [2]);
      expect(result.text).toBe(
        "`.2` could mean two things. Write it out: `.a 11 2` answers question 11; `.u 2` picks row 2 of the list.",
      );
      expect(ctx.fake.dispatch).not.toHaveBeenCalled();
    });

    it("after the gap answers the card", async () => {
      const { ctx } = setup();
      await card(ctx);
      const after = Object.assign(Object.create(ctx) as TestContext, {
        inbound: {
          id: "m",
          createdAtMs: ctx.now + BARE_GAP_MS + 1,
          pollStartedAtMs: ctx.now + BARE_GAP_MS + 1,
        },
      });
      await handleNumber(after, [2]);
      expect(ctx.fake.dispatch).toHaveBeenCalledWith({
        kind: "command",
        name: "answer",
        args: [],
        tail: "11 2",
      });
    });
  });
});
