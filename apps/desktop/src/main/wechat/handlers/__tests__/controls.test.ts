// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PineApprovalMode } from "../../../../shared/agent";
import type {
  PineModelCatalog,
  PineModelDescriptor,
} from "../../../../shared/models";
import { parseCommand } from "../../parseCommand";
import type { ApprovalAsk, ConfirmAsk, ParsedCommand } from "../../types";
import {
  createTestContext,
  summary,
  W,
  type TestContext,
  type TestContextOverrides,
} from "../../__tests__/fakes";
import { controlHandlers } from "../controls";

function descriptor(
  providerId: string,
  id: string,
  levels: PineModelDescriptor["supportedThinkingLevels"] = [
    "off",
    "low",
    "medium",
    "high",
  ],
): PineModelDescriptor {
  return {
    api: "openai-responses",
    contextWindow: 200_000,
    id,
    input: ["text"],
    maxTokens: 32_000,
    name: `Model ${id}`,
    providerId,
    providerName: `Provider ${providerId}`,
    reasoning: true,
    supportedThinkingLevels: levels,
  };
}

const CATALOG: PineModelCatalog = {
  models: [
    descriptor("acme", "alpha"),
    descriptor("acme", "beta", ["off", "minimal"]),
    descriptor("other", "gamma"),
    descriptor("acme", "delta"),
  ],
  providers: [
    {
      id: "acme",
      name: "Acme",
      configured: true,
      authMethods: [],
      modelCount: 3,
    },
    {
      id: "other",
      name: "Other",
      configured: false,
      authMethods: [],
      modelCount: 1,
    },
  ],
  recommendedModelIds: ["delta"],
  selection: { providerId: "acme", modelId: "alpha", thinkingLevel: "high" },
};

function setup(
  overrides: TestContextOverrides & {
    mode?: PineApprovalMode;
    live?: boolean;
  } = {},
): TestContext {
  const ctx = createTestContext(overrides);
  const core = ctx.fake.core;
  core.addProject("p1");
  if (overrides.live === false) {
    core.storeSession(
      "p1",
      summary("s1", {
        approvalMode: overrides.mode ?? "auto-approve",
        name: "Fix login",
      }),
    );
  } else {
    const session = core.runtimes.addLiveSession({
      sessionId: "s1",
      projectId: "p1",
      clientId: W,
      mode: overrides.mode ?? "auto-approve",
      name: "Fix login",
    });
    session.summary = {
      ...session.summary,
      modelSelection: {
        providerId: "acme",
        modelId: "alpha",
        thinkingLevel: "high",
      },
      messageCount: 12,
    };
  }
  core.runtimes.getModelCatalog.mockResolvedValue(CATALOG);
  void ctx.store.update((draft) => {
    draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: ctx.now };
  });
  return ctx;
}

function command(text: string): ParsedCommand {
  const parsed = parseCommand(text);
  if (parsed.kind !== "command") throw new Error(`not a command: ${text}`);
  return parsed;
}

async function run(ctx: TestContext, text: string) {
  const parsed = command(text);
  const handler = controlHandlers[parsed.name];
  if (!handler) throw new Error(`no handler for ${parsed.name}`);
  return handler(ctx, parsed);
}

describe(".model", () => {
  it("lists configured models, recommended first, the session's marked", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const result = await run(ctx, ".m");
    const text = result.text ?? "";
    expect(text).not.toContain("gamma");
    expect(text.indexOf("Model delta")).toBeLessThan(
      text.indexOf("Model alpha"),
    );
    expect(text).toContain("* Model alpha");
    expect(result.numbered).toEqual({ kind: "model" });
  });

  it("switches the current session's model, always with its id", async () => {
    const ctx = setup();
    await ctx.store.flush();
    await run(ctx, ".m");
    ctx.handles.noteDelivered("model", ctx.now);
    const result = await run(ctx, ".m 1");
    expect(ctx.fake.core.runtimes.selectModel).toHaveBeenCalledWith(W, {
      providerId: "acme",
      modelId: "delta",
      thinkingLevel: "high",
      sessionId: "s1",
      projectId: "p1",
    });
    expect(result.text).toContain("Model delta");
  });

  it("falls back to the model's default effort, by name", async () => {
    const ctx = setup();
    await ctx.store.flush();
    await run(ctx, ".m beta");
    expect(ctx.fake.core.runtimes.selectModel).toHaveBeenCalledWith(
      W,
      expect.objectContaining({ modelId: "beta", thinkingLevel: "off" }),
    );
  });

  it("needs a current session to switch", async () => {
    const ctx = setup();
    await ctx.store.update((draft) => {
      delete draft.current;
    });
    const list = await run(ctx, ".m");
    expect(list.text).toContain("Model alpha");
    ctx.handles.noteDelivered("model", ctx.now);
    const result = await run(ctx, ".m 1");
    expect(result.text).toContain("No current session");
    expect(ctx.fake.core.runtimes.selectModel).not.toHaveBeenCalled();
  });

  it("refuses a view-only session", async () => {
    const ctx = setup({ mode: "YOLO" });
    await ctx.store.flush();
    const result = await run(ctx, ".m alpha");
    expect(result.text).toContain("above the WeChat ceiling");
    expect(ctx.fake.core.runtimes.selectModel).not.toHaveBeenCalled();
  });

  it("answers E-REF for an undelivered number", async () => {
    const ctx = setup();
    await ctx.store.flush();
    expect((await run(ctx, ".m 3")).text).toContain("no longer valid");
  });
});

describe(".effort", () => {
  it("lists the supported levels and switches by word or number", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const list = await run(ctx, ".e");
    expect(list.text).toContain("* High");
    await run(ctx, ".e 高");
    expect(ctx.fake.core.runtimes.selectModel).toHaveBeenLastCalledWith(W, {
      providerId: "acme",
      modelId: "alpha",
      thinkingLevel: "high",
      sessionId: "s1",
      projectId: "p1",
    });
    await run(ctx, ".e 2");
    expect(ctx.fake.core.runtimes.selectModel).toHaveBeenLastCalledWith(
      W,
      expect.objectContaining({ thinkingLevel: "low" }),
    );
  });

  it("refuses a level the model does not support", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const result = await run(ctx, ".e max");
    expect(result.text).toContain("Usage: `.effort");
    expect(ctx.fake.core.runtimes.selectModel).not.toHaveBeenCalled();
  });
});

describe(".mode", () => {
  it("lists the modes with the ceiling", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const result = await run(ctx, ".mo");
    expect(result.text).toContain("* Auto Approve");
    expect(result.text).toContain("🔒 Autonomous Work");
  });

  it("tightens a live session through setApprovalMode", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const result = await run(ctx, ".mo review");
    expect(ctx.fake.core.runtimes.setApprovalMode).toHaveBeenCalledWith(
      W,
      "let-me-review",
      "s1",
    );
    expect(result.text).toContain("uses up replies quickly");
  });

  it("tightens a view-only session back under the ceiling", async () => {
    const ctx = setup({ mode: "YOLO" });
    await ctx.store.flush();
    await run(ctx, ".mo 2");
    expect(ctx.fake.core.runtimes.setApprovalMode).toHaveBeenCalledWith(
      W,
      "auto-approve",
      "s1",
    );
    expect(await ctx.sessions.modeFor("s1", "p1")).toBe("auto-approve");
  });

  it("refuses loosening above the ceiling and on a view-only session", async () => {
    const ctx = setup();
    await ctx.store.flush();
    expect((await run(ctx, ".mo autonomous")).text).toContain(
      "no higher than Auto Approve",
    );
    const view = setup({
      mode: "autonomous",
      settings: { ceilingMode: "auto-approve" },
    });
    await view.store.flush();
    expect((await run(view, ".mo yolo")).text).toContain(
      "above the WeChat ceiling",
    );
    expect(ctx.fake.core.runtimes.setApprovalMode).not.toHaveBeenCalled();
    expect(view.fake.core.runtimes.setApprovalMode).not.toHaveBeenCalled();
  });

  it("needs a YOLO ceiling and a confirmation for yolo", async () => {
    const low = setup({ settings: { ceilingMode: "autonomous" } });
    await low.store.flush();
    expect((await run(low, ".mo yolo")).text).toContain("no higher than");

    const ctx = setup({ settings: { ceilingMode: "YOLO" } });
    await ctx.store.flush();
    const asked = await run(ctx, ".mo yolo");
    expect(asked.text).toContain("irreversible data loss");
    expect(ctx.fake.core.runtimes.setApprovalMode).not.toHaveBeenCalled();
    const confirm = ctx.asks.list().find((ask) => ask.kind === "confirm");
    expect(confirm?.resolved).toEqual({
      sessionId: "s1",
      projectId: "p1",
      mode: "YOLO",
    });
    if (!confirm) return;

    const confirmed = Object.assign(Object.create(ctx) as TestContext, {
      confirmed: confirm,
    });
    const done = await controlHandlers.mode?.(confirmed, confirm.command);
    expect(ctx.fake.core.runtimes.setApprovalMode).toHaveBeenCalledWith(
      W,
      "YOLO",
      "s1",
    );
    expect(done?.text).toContain("Approval mode: YOLO");
    expect(ctx.fake.host.notifications).toEqual([
      expect.objectContaining({ kind: "mode-raised", sessionId: "s1" }),
    ]);
  });

  it("stores an override for a session that is not live", async () => {
    const ctx = setup({ live: false, settings: { ceilingMode: "autonomous" } });
    await ctx.store.flush();
    const result = await run(ctx, ".mo autonomous");
    expect(ctx.fake.core.runtimes.setApprovalMode).not.toHaveBeenCalled();
    expect(ctx.store.get().modeOverride.s1).toBe("autonomous");
    expect(result.text).toContain("Autonomous Work");
  });

  it("acts as the window controlling the session", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const session = ctx.fake.core.runtimes.live.get("s1");
    ctx.fake.core.runtimes.openProject(7, "p1");
    if (session) session.controllerId = 7;
    await run(ctx, ".mo 1");
    expect(ctx.fake.core.runtimes.setApprovalMode).toHaveBeenCalledWith(
      7,
      "let-me-review",
      "s1",
    );
  });
});

describe(".usage and .todo", () => {
  it("shows model, mode, context and cost", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const session = ctx.fake.core.runtimes.live.get("s1");
    if (session)
      session.contextUsage = {
        tokens: 50_000,
        contextWindow: 200_000,
        percent: 25,
        cost: 0.42,
        cacheHitRate: 0.8,
      };
    const result = await run(ctx, ".i");
    expect(result.text).toContain("Model alpha");
    expect(result.text).toContain("25%");
    expect(result.text).toContain("$0.42");
    expect(result.text).toContain("12 messages");
  });

  it("lists the todos without deleted ones", async () => {
    const ctx = setup();
    await ctx.store.flush();
    ctx.fake.core.runtimes.transcripts.set("s1", {
      hasMore: false,
      messages: [],
      todos: {
        nextId: 4,
        tasks: [
          { id: 1, subject: "Write tests", status: "completed" },
          { id: 2, subject: "Fix bug", status: "in_progress" },
          { id: 3, subject: "Gone", status: "deleted" },
        ],
      },
    });
    const result = await run(ctx, ".t");
    expect(result.text).toContain("Todos 1/2");
    expect(result.text).not.toContain("Gone");
    expect(ctx.fake.core.runtimes.loadMessages).toHaveBeenCalledWith(
      W,
      "p1",
      "s1",
      undefined,
      1,
      true,
    );
  });
});

describe(".compact", () => {
  function openLongContext(ctx: TestContext): ApprovalAsk {
    return ctx.asks.open({
      kind: "approval",
      requestId: randomUUID(),
      sessionId: "s1",
      projectId: "p1",
      trigger: "long-context-activation",
      toolName: "activate",
      subjectCut: false,
      external: false,
    }) as ApprovalAsk;
  }

  it("refuses a number that is not a long-context ask and compacts nothing", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const confirm = ctx.asks.open({
      kind: "confirm",
      command: command(".del 2"),
      resolved: {},
    }) as ConfirmAsk;
    const result = await run(ctx, `.c ${confirm.number}`);
    expect(result.text).toContain("Usage: `.compact");
    expect(result.text).toContain(`.d ${confirm.number}`);
    expect(ctx.fake.core.runtimes.compact).not.toHaveBeenCalled();
    expect(ctx.fake.core.runtimes.respondApproval).not.toHaveBeenCalled();
    expect(ctx.asks.status(confirm.number)).toBe("open");
  });

  it("answers a long-context card with compact", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const ask = openLongContext(ctx);
    await run(ctx, `.c ${ask.number}`);
    expect(ctx.fake.core.runtimes.respondApproval).toHaveBeenCalledWith(W, {
      requestId: ask.requestId,
      action: "compact",
    });
    expect(ctx.asks.status(ask.number)).toBe("tombstone");
  });

  it("answers the only long-context card without a number", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const ask = openLongContext(ctx);
    await run(ctx, ".c");
    expect(ctx.fake.core.runtimes.respondApproval).toHaveBeenCalledWith(W, {
      requestId: ask.requestId,
      action: "compact",
    });
    expect(ctx.fake.core.runtimes.compact).not.toHaveBeenCalled();
  });

  it("compacts a live session and reports the end in a second message", async () => {
    const ctx = setup();
    await ctx.store.flush();
    const result = await run(ctx, ".c");
    expect(result.text).toContain("Compacting");
    expect(ctx.fake.core.runtimes.compact).not.toHaveBeenCalled();
    await result.after?.();
    expect(ctx.fake.core.runtimes.compact).toHaveBeenCalledWith(W, "s1");
    expect(ctx.fake.channel.texts.at(-1)).toContain("Context compacted");
  });

  it("answers R-COMPACT-IDLE for a session that is not live", async () => {
    const ctx = setup({ live: false });
    await ctx.store.flush();
    const result = await run(ctx, ".c");
    expect(result.text).toContain("Nothing is loaded to compact");
    expect(ctx.fake.core.runtimes.compact).not.toHaveBeenCalled();
  });

  it("refuses a view-only session", async () => {
    const ctx = setup({ mode: "YOLO" });
    await ctx.store.flush();
    expect((await run(ctx, ".c")).text).toContain("above the WeChat ceiling");
    expect(ctx.fake.core.runtimes.compact).not.toHaveBeenCalled();
  });
});
