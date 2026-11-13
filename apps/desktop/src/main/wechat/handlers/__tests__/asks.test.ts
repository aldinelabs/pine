// @vitest-environment node
import { randomUUID } from "node:crypto";
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { describe, expect, it, vi } from "vitest";
import type { PineApprovalMode } from "../../../../shared/agent";
import { STALE_MS } from "../../constants";
import { parseCommand } from "../../parseCommand";
import type {
  ApprovalAsk,
  ConfirmAsk,
  HeldAsk,
  ParsedCommand,
  QuestionAsk,
} from "../../types";
import {
  createTestContext,
  W,
  type TestContext,
  type TestContextOverrides,
} from "../../__tests__/fakes";
import { askHandlers } from "../asks";

function setup(
  overrides: TestContextOverrides & { mode?: PineApprovalMode } = {},
): TestContext {
  const ctx = createTestContext(overrides);
  ctx.fake.core.addProject("p1");
  ctx.fake.core.runtimes.addLiveSession({
    sessionId: "s1",
    projectId: "p1",
    clientId: W,
    mode: overrides.mode ?? "auto-approve",
    name: "Fix login",
  });
  return ctx;
}

function openApproval(
  ctx: TestContext,
  overrides: Partial<ApprovalAsk> = {},
): ApprovalAsk {
  const ask = ctx.asks.open({
    kind: "approval",
    requestId: randomUUID(),
    actionDigest: "digest-1",
    sessionId: "s1",
    projectId: "p1",
    trigger: "pre-execution",
    toolName: "bash",
    input: { subject: "rm -rf build/ && make", description: "Rebuild" },
    subjectCut: false,
    external: false,
    ...overrides,
  });
  if (ask?.kind !== "approval") throw new Error("no ask");
  return ask;
}

const TWO_QUESTIONS: AskUserQuestionParams = {
  questions: [
    {
      header: "Login",
      question: "Which login?",
      options: [
        { label: "Email code", description: "One-time code" },
        { label: "Password", description: "Classic" },
      ],
    },
    {
      header: "Envs",
      question: "Which environments?",
      multiSelect: true,
      options: [
        { label: "Dev", description: "" },
        { label: "Staging", description: "" },
        { label: "Prod", description: "" },
      ],
    },
  ],
};

const ONE_QUESTION: AskUserQuestionParams = {
  questions: [
    {
      header: "Name",
      question: "What should it be called?",
      options: [
        { label: "Alpha", description: "" },
        { label: "Beta", description: "" },
      ],
    },
  ],
};

function openQuestion(
  ctx: TestContext,
  questionnaire: AskUserQuestionParams = TWO_QUESTIONS,
  overrides: Partial<QuestionAsk> = {},
): QuestionAsk {
  const ask = ctx.asks.open({
    kind: "question",
    requestId: randomUUID(),
    sessionId: "s1",
    projectId: "p1",
    questionnaire,
    answerable: true,
    ...overrides,
  });
  if (ask?.kind !== "question") throw new Error("no ask");
  return ask;
}

function command(text: string): ParsedCommand {
  const parsed = parseCommand(text);
  if (parsed.kind !== "command") throw new Error(`not a command: ${text}`);
  return parsed;
}

async function run(ctx: TestContext, text: string) {
  const parsed = command(text);
  const handler = askHandlers[parsed.name];
  if (!handler) throw new Error(`no handler for ${parsed.name}`);
  return handler(ctx, parsed);
}

const respond = (ctx: TestContext) => ctx.fake.core.runtimes.respondApproval;
const answerFn = (ctx: TestContext) =>
  ctx.fake.core.runtimes.respondQuestionnaire;

describe(".approve", () => {
  it("approves an approvable card as the responder and tombstones it", async () => {
    const ctx = setup();
    const ask = openApproval(ctx);
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).toHaveBeenCalledWith(W, {
      requestId: ask.requestId,
      action: "approve",
    });
    expect(result.text).toContain(`Approved ${ask.number}`);
    expect(ctx.asks.status(ask.number)).toBe("tombstone");
  });

  it.each([
    { trigger: "sandbox-denied" as const, toolName: "bash" },
    { trigger: "authorize-denied" as const, toolName: "write" },
    { trigger: "pre-execution" as const, toolName: "some_future_tool" },
  ])("approves $trigger $toolName by default", async (card) => {
    const ctx = setup();
    const ask = openApproval(ctx, card);
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Approved");
    expect(ctx.fake.host.notifications).toHaveLength(0);
  });

  it.each(["privileged-execution", "destructive-pattern"] as const)(
    "keeps %s display-only without the switch",
    async (trigger) => {
      const ctx = setup();
      const ask = openApproval(ctx, { trigger });
      const result = await run(ctx, `.y ${ask.number}`);
      expect(respond(ctx)).not.toHaveBeenCalled();
      expect(result.text).toContain("can only be approved on the computer");
      expect(ctx.asks.status(ask.number)).toBe("open");
    },
  );

  it("approves a high-risk card with the switch and notifies locally", async () => {
    const ctx = setup({ settings: { allowHighRiskApprovals: true } });
    const ask = openApproval(ctx, { trigger: "privileged-execution" });
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("Approved");
    expect(ctx.fake.host.notifications).toEqual([
      expect.objectContaining({
        kind: "high-risk-approved",
        sessionId: "s1",
        projectId: "p1",
      }),
    ]);
  });

  it("refuses a view-only session with E-VIEW", async () => {
    const ctx = setup({ mode: "autonomous" });
    const ask = openApproval(ctx);
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).not.toHaveBeenCalled();
    expect(result.text).toContain("above the WeChat ceiling");
  });

  it("refuses an automation run with E-VIEWRUN", async () => {
    const ctx = setup();
    ctx.fake.core.automations.running.add("s1");
    const ask = openApproval(ctx);
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).not.toHaveBeenCalled();
    expect(result.text).toContain("automation run");
  });

  it.each([
    ["too old", (now: number) => now - STALE_MS - 1],
    ["missing", () => 0],
    ["in the future", (now: number) => now + 3 * 60_000],
  ])("does not run a stale message (%s)", async (_label, created) => {
    const base = setup();
    const ask = openApproval(base);
    const ctx = Object.assign(Object.create(base) as TestContext, {
      inbound: { ...base.inbound, createdAtMs: created(base.now) },
    });
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(base)).not.toHaveBeenCalled();
    expect(result.text).toContain("Not run");
  });

  it("answers E-DONE for a tombstone and E-CODE for an unknown number", async () => {
    const ctx = setup();
    const ask = openApproval(ctx);
    ctx.asks.close(ask.number, "decided");
    expect((await run(ctx, `.y ${ask.number}`)).text).toContain(
      "already handled",
    );
    expect((await run(ctx, ".y 77")).text).toContain("Nothing is waiting");
    expect(respond(ctx)).not.toHaveBeenCalled();
  });

  it("refuses when the action digest changed while the policy was read", async () => {
    const ctx = setup();
    const ask = openApproval(ctx);
    const verdict = ctx.sessions.verdict.bind(ctx.sessions);
    vi.spyOn(ctx.sessions, "verdict").mockImplementation(async (value) => {
      const result = await verdict(value);
      value.actionDigest = "digest-2";
      return result;
    });
    const result = await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).not.toHaveBeenCalled();
    expect(result.text).toContain("already handled");
  });

  it("needs .show before approving a cut subject", async () => {
    const ctx = setup();
    const long = `echo ${"x".repeat(400)}`;
    const ask = openApproval(ctx, {
      input: { subject: long },
      subjectCut: true,
    });
    const first = await run(ctx, `.y ${ask.number}`);
    expect(first.text).toContain(`Reply \`.${ask.number}\` to read all of it`);
    expect(respond(ctx)).not.toHaveBeenCalled();

    const shown = await run(ctx, `.show ${ask.number}`);
    expect(shown.shown).toEqual([{ ask: ask.number, full: true }]);
    expect(shown.text).toContain("x".repeat(400));
    ctx.asks.markShown(ask.number, ctx.now);
    // A message written before the full card was delivered still cannot approve it.
    const early = await run(ctx, `.y ${ask.number}`);
    expect(early.text).toContain("cut short");

    const shownAt = ctx.now;
    // Written a second later by the server clock, in the same poll batch: the
    // clocks may disagree by that much, so it is still too early.
    ctx.fake.clock.advance(1000);
    const sameBatch = Object.assign(Object.create(ctx) as TestContext, {
      inbound: {
        ...ctx.inbound,
        createdAtMs: ctx.now,
        pollStartedAtMs: shownAt,
      },
    });
    expect((await run(sameBatch, `.y ${ask.number}`)).text).toContain(
      "cut short",
    );
    const skewed = Object.assign(Object.create(ctx) as TestContext, {
      inbound: {
        ...ctx.inbound,
        createdAtMs: ctx.now,
        pollStartedAtMs: ctx.now,
      },
    });
    expect((await run(skewed, `.y ${ask.number}`)).text).toContain("cut short");
    expect(respond(ctx)).not.toHaveBeenCalled();

    ctx.fake.clock.advance(10_000);
    const later = Object.assign(Object.create(ctx) as TestContext, {
      inbound: {
        ...ctx.inbound,
        createdAtMs: ctx.now,
        pollStartedAtMs: ctx.now,
      },
    });
    const approved = await run(later, `.y ${ask.number}`);
    expect(approved.text).toContain("Approved");
    expect(respond(ctx)).toHaveBeenCalledTimes(1);
  });

  it("approves a card with no subject", async () => {
    const ctx = setup();
    const ask = openApproval(ctx, { input: {}, toolName: "computer_use" });
    expect((await run(ctx, `.y ${ask.number}`)).text).toContain("Approved");
  });

  it("refuses a bare .y for a single approval", async () => {
    const ctx = setup();
    const ask = openApproval(ctx);
    ctx.asks.markDelivered(ask.number, ctx.now - 60_000);
    const result = await run(ctx, ".y");
    expect(respond(ctx)).not.toHaveBeenCalled();
    expect(result.text).toContain(`.y ${ask.number}`);
  });

  it("runs a held batch on a bare .y, in order, with heldConfirmed", async () => {
    const ctx = setup();
    const held = ctx.asks.open({
      kind: "held",
      reason: "stale",
      items: [
        {
          id: "m1",
          createdAtMs: 1,
          pollStartedAtMs: 1,
          text: ".new run the tests",
          media: [],
        },
        {
          id: "m2",
          createdAtMs: 2,
          pollStartedAtMs: 2,
          text: "send me the result",
          quotedText: "earlier",
          media: [],
        },
      ],
    }) as HeldAsk;
    ctx.fake.dispatch
      .mockResolvedValueOnce({ text: "started" })
      .mockResolvedValueOnce({ text: "sent" });
    const result = await run(ctx, ".y");
    expect(ctx.fake.dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "command", name: "new" }),
      { heldConfirmed: true },
    );
    expect(ctx.fake.dispatch).toHaveBeenNthCalledWith(
      2,
      { kind: "message", text: "send me the result" },
      { heldConfirmed: true, quotedText: "earlier" },
    );
    expect(result.text).toBe("started\n\nsent");
    expect(ctx.asks.status(held.number)).toBe("tombstone");
  });

  it("executes a confirmation through dispatch with the ask", async () => {
    const ctx = setup();
    const confirm = ctx.asks.open({
      kind: "confirm",
      command: command(".del 2"),
      resolved: { sessionId: "s1", projectId: "p1" },
    }) as ConfirmAsk;
    ctx.fake.dispatch.mockResolvedValueOnce({ text: "Deleted" });
    const result = await run(ctx, `.y ${confirm.number}`);
    expect(ctx.fake.dispatch).toHaveBeenCalledWith(confirm.command, {
      confirmed: confirm,
    });
    expect(result.text).toBe("Deleted");
    expect(ctx.asks.status(confirm.number)).toBe("tombstone");
  });

  it("refuses a question card and a long-context card", async () => {
    const ctx = setup();
    const question = openQuestion(ctx);
    expect((await run(ctx, `.y ${question.number}`)).text).toContain(
      `.a ${question.number}`,
    );
    const long = openApproval(ctx, { trigger: "long-context-activation" });
    expect((await run(ctx, `.y ${long.number}`)).text).toContain(
      `.c ${long.number}`,
    );
    expect(respond(ctx)).not.toHaveBeenCalled();
  });

  it("loses the race to the computer with E-DONE", async () => {
    const ctx = setup();
    const ask = openApproval(ctx);
    respond(ctx).mockImplementationOnce(() => {
      throw new Error("This approval request is no longer pending.");
    });
    const result = await run(ctx, `.y ${ask.number}`);
    expect(result.text).toContain("already handled");
    expect(ctx.asks.tombstoneOf(ask.number)?.reason).toBe("decided");
  });

  it("answers as the window when the bridge does not hold the session's runtime", async () => {
    const ctx = createTestContext();
    ctx.fake.core.addProject("p2");
    ctx.fake.core.runtimes.addLiveSession({
      sessionId: "s2",
      projectId: "p2",
      clientId: 7,
      controllerId: 7,
    });
    const ask = ctx.asks.open({
      kind: "approval",
      requestId: randomUUID(),
      sessionId: "s2",
      projectId: "p2",
      trigger: "pre-execution",
      toolName: "bash",
      input: { subject: "ls" },
      subjectCut: false,
      external: false,
    }) as ApprovalAsk;
    await run(ctx, `.y ${ask.number}`);
    expect(respond(ctx)).toHaveBeenCalledWith(7, {
      requestId: ask.requestId,
      action: "approve",
    });
  });
});

describe(".reject and .guide", () => {
  it("rejects, and rejects with guidance", async () => {
    const ctx = setup();
    const a = openApproval(ctx);
    expect((await run(ctx, `.d ${a.number}`)).text).toContain("Rejected");
    expect(respond(ctx)).toHaveBeenLastCalledWith(W, {
      requestId: a.requestId,
      action: "reject",
    });
    const b = openApproval(ctx);
    expect(
      (await run(ctx, `.d ${b.number} run the tests first`)).text,
    ).toContain("passed your note");
    expect(respond(ctx)).toHaveBeenLastCalledWith(W, {
      requestId: b.requestId,
      action: "guide",
      guidance: "run the tests first",
    });
  });

  it("reads .d 30 text as guidance when 30 is not an ask", async () => {
    const ctx = setup();
    const a = openApproval(ctx);
    await run(ctx, ".d 30 files please");
    expect(respond(ctx)).toHaveBeenCalledWith(W, {
      requestId: a.requestId,
      action: "guide",
      guidance: "30 files please",
    });
  });

  it("needs a number when several asks are open", async () => {
    const ctx = setup();
    openApproval(ctx);
    openApproval(ctx);
    const result = await run(ctx, ".d");
    expect(result.text).toContain("2 waiting");
    expect(respond(ctx)).not.toHaveBeenCalled();
  });

  it(".guide needs text", async () => {
    const ctx = setup();
    const a = openApproval(ctx);
    expect((await run(ctx, `.g ${a.number}`)).text).toContain("Usage: `.guide");
    await run(ctx, `.g ${a.number} use the staging db`);
    expect(respond(ctx)).toHaveBeenCalledWith(W, {
      requestId: a.requestId,
      action: "guide",
      guidance: "use the staging db",
    });
  });

  it("works on a display-only card and a view-only session", async () => {
    const ctx = setup({ mode: "autonomous" });
    const a = openApproval(ctx, { trigger: "destructive-pattern" });
    expect((await run(ctx, `.d ${a.number}`)).text).toContain("Rejected");
    expect(respond(ctx)).toHaveBeenCalledTimes(1);
  });

  it("refuses guidance to a view-only session but still lets it reject", async () => {
    const ctx = setup({ mode: "autonomous" });
    const a = openApproval(ctx);
    for (const text of [`.g ${a.number} do X`, `.d ${a.number} do X`]) {
      expect((await run(ctx, text)).text).toContain("above the WeChat ceiling");
    }
    expect(respond(ctx)).not.toHaveBeenCalled();
    expect((await run(ctx, `.d ${a.number}`)).text).toContain("Rejected");
    expect(respond(ctx)).toHaveBeenCalledExactlyOnceWith(W, {
      requestId: a.requestId,
      action: "reject",
    });
  });

  it("stops on a long-context card", async () => {
    const ctx = setup();
    const a = openApproval(ctx, { trigger: "long-context-activation" });
    await run(ctx, `.d ${a.number}`);
    expect(respond(ctx)).toHaveBeenCalledWith(W, {
      requestId: a.requestId,
      action: "abort",
    });
  });

  it("cancels a question, a confirmation and a held batch", async () => {
    const ctx = setup();
    const q = openQuestion(ctx);
    expect((await run(ctx, `.d ${q.number}`)).text).toContain("Cancelled");
    expect(answerFn(ctx)).toHaveBeenCalledWith(W, {
      requestId: q.requestId,
      submission: { cancelled: true, answers: [] },
    });
    const confirm = ctx.asks.open({
      kind: "confirm",
      command: command(".del 2"),
      resolved: {},
    }) as ConfirmAsk;
    expect((await run(ctx, `.d ${confirm.number}`)).text).toContain(
      "Cancelled",
    );
    expect(ctx.fake.dispatch).not.toHaveBeenCalled();
    expect(ctx.asks.status(confirm.number)).toBe("tombstone");
  });

  it("refuses text on a question card", async () => {
    const ctx = setup();
    const q = openQuestion(ctx);
    expect((await run(ctx, `.d ${q.number} hmm`)).text).toContain("Usage");
    expect(answerFn(ctx)).not.toHaveBeenCalled();
  });

  it("does not act on an ask newer than a stale message", async () => {
    const base = setup();
    const a = openApproval(base);
    const ctx = Object.assign(Object.create(base) as TestContext, {
      inbound: { ...base.inbound, createdAtMs: base.now - STALE_MS - 1 },
    });
    const result = await run(ctx, `.d ${a.number}`);
    expect(result.text).toContain("Not run");
    expect(respond(base)).not.toHaveBeenCalled();
  });
});

describe(".answer", () => {
  it("maps answers to the schema (1-based to 0-based)", async () => {
    const ctx = setup();
    const q = openQuestion(ctx);
    const result = await run(ctx, `.a ${q.number} 2; 1,3`);
    expect(answerFn(ctx)).toHaveBeenCalledWith(W, {
      requestId: q.requestId,
      submission: {
        cancelled: false,
        answers: [
          { questionIndex: 0, selectedOptionIndexes: [1] },
          { questionIndex: 1, selectedOptionIndexes: [0, 2] },
        ],
      },
    });
    expect(result.text).toContain("Password; Dev, Prod");
    expect(ctx.asks.status(q.number)).toBe("tombstone");
  });

  it("keeps semicolons in the free text of a one-question card", async () => {
    const ctx = setup();
    const q = openQuestion(ctx, ONE_QUESTION);
    await run(ctx, `.a ${q.number} gamma; or delta`);
    expect(answerFn(ctx)).toHaveBeenCalledWith(W, {
      requestId: q.requestId,
      submission: {
        cancelled: false,
        answers: [
          {
            questionIndex: 0,
            selectedOptionIndexes: [],
            customAnswer: "gamma; or delta",
          },
        ],
      },
    });
  });

  it("reads =2 as literal text and answers without a number when one card is open", async () => {
    const ctx = setup();
    const q = openQuestion(ctx, ONE_QUESTION);
    await run(ctx, ".a =2");
    expect(answerFn(ctx)).toHaveBeenCalledWith(W, {
      requestId: q.requestId,
      submission: {
        cancelled: false,
        answers: [
          { questionIndex: 0, selectedOptionIndexes: [], customAnswer: "2" },
        ],
      },
    });
  });

  it.each([
    ["a count mismatch", "2", "has 2 part(s)"],
    [
      "several options on a single-select question",
      "1,2; 1",
      "takes one option",
    ],
    ["an option that does not exist", "3; 1", "has no option 3"],
  ])("refuses %s with E-ANSWER", async (_label, answers, expected) => {
    const ctx = setup();
    const q = openQuestion(ctx);
    const result = await run(ctx, `.a ${q.number} ${answers}`);
    expect(result.text).toContain(expected);
    expect(answerFn(ctx)).not.toHaveBeenCalled();
    expect(ctx.asks.status(q.number)).toBe("open");
  });

  it("refuses a view-only session's question card", async () => {
    const ctx = setup({ mode: "YOLO" });
    const q = openQuestion(ctx);
    const result = await run(ctx, `.a ${q.number} 1; 1`);
    expect(result.text).toContain("above the WeChat ceiling");
    expect(answerFn(ctx)).not.toHaveBeenCalled();
  });

  it("refuses a card that cannot be answered in text", async () => {
    const ctx = setup();
    const q = openQuestion(ctx, ONE_QUESTION, { answerable: false });
    const result = await run(ctx, `.a ${q.number} 1`);
    expect(result.text).toContain("can only be approved on the computer");
    expect(answerFn(ctx)).not.toHaveBeenCalled();
  });

  it("does not run a stale answer", async () => {
    const base = setup();
    const q = openQuestion(base);
    const ctx = Object.assign(Object.create(base) as TestContext, {
      inbound: { ...base.inbound, createdAtMs: base.now - STALE_MS - 1 },
    });
    expect((await run(ctx, `.a ${q.number} 1; 1`)).text).toContain("Not run");
    expect(answerFn(base)).not.toHaveBeenCalled();
  });

  it("loses the race with E-DONE", async () => {
    const ctx = setup();
    const q = openQuestion(ctx);
    answerFn(ctx).mockImplementationOnce(() => {
      throw new Error("This questionnaire is no longer pending.");
    });
    expect((await run(ctx, `.a ${q.number} 1; 1`)).text).toContain(
      "already handled",
    );
  });
});

describe(".pending and .show", () => {
  it("lists every open ask and the automation approvals", async () => {
    const ctx = setup();
    const a = openApproval(ctx);
    const q = openQuestion(ctx);
    ctx.fake.core.automations.pendingApprovals.mockReturnValue([{}, {}]);
    const result = await run(ctx, ".w");
    expect(result.text).toContain("2 waiting");
    expect(result.text).toContain(`**${a.number}** bash`);
    expect(result.text).toContain(`**${q.number}** question`);
    expect(result.text).toContain("2 automation change(s)");
  });

  it("shows a question card again", async () => {
    const ctx = setup();
    const q = openQuestion(ctx);
    const result = await run(ctx, `.show ${q.number}`);
    expect(result.text).toContain(`Question ${q.number}`);
    expect(result.shown).toEqual([{ ask: q.number, full: false }]);
  });

  it("pages a subject longer than one .show", async () => {
    const ctx = setup();
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const a = openApproval(ctx, {
      input: { subject: words },
      subjectCut: true,
    });
    const result = await run(ctx, `.show ${a.number}`);
    expect(result.text).toContain("reply `.0` for the next part");
    expect(ctx.pager.remaining()).toBeGreaterThan(0);
    const rest: string[] = [];
    for (let page = ctx.pager.next(); page; page = ctx.pager.next())
      rest.push(page.text);
    expect(rest.at(-1)).toContain("word499");
  });

  it("marks a display-only card as local", async () => {
    const ctx = setup();
    const a = openApproval(ctx, { trigger: "privileged-execution" });
    const result = await run(ctx, `.show ${a.number}`);
    expect(result.text).toContain("Approve on the computer");
  });
});
