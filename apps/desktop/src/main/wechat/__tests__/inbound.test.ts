// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelInboundMessage } from "../channel";
import { PAUSED_NOTICE_INTERVAL_MS, STALE_MS } from "../constants";
import type {
  CommandContext,
  CommandHandler,
  CommandResult,
  HandlerRegistry,
} from "../handlers/types";
import { InboundPipeline, classify } from "../inbound";
import { render } from "../replies";
import { refuse } from "../sessionDirectory";
import {
  COMMAND_NAMES,
  type CommandName,
  type HeldAsk,
  type StoredInbound,
} from "../types";
import {
  BOT_ID,
  OWNER_USER_ID,
  createTestContext,
  type TestContext,
} from "./fakes";

afterEach(() => {
  vi.restoreAllMocks();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

interface Call {
  kind: "command" | "message" | "number";
  name: string;
  ctx: CommandContext;
}

function setup(
  options: {
    commands?: Partial<Record<CommandName, CommandHandler>>;
    message?: (ctx: CommandContext, text: string) => Promise<CommandResult>;
    state?: Partial<ReturnType<TestContext["store"]["get"]>>;
  } = {},
) {
  const ctx = createTestContext();
  if (options.state) {
    const state = options.state;
    ctx.fake.store.updateSoon((draft) => Object.assign(draft, state));
  }
  const calls: Call[] = [];
  const commands: Partial<Record<CommandName, CommandHandler>> = {};
  for (const name of COMMAND_NAMES) {
    commands[name] = (handlerCtx, command) => {
      calls.push({ kind: "command", name, ctx: handlerCtx });
      return Promise.resolve({
        text: `ran .${name}${command.tail ? ` ${command.tail}` : ""}`,
      });
    };
  }
  for (const [name, handler] of Object.entries(options.commands ?? {})) {
    commands[name as CommandName] = (handlerCtx, command) => {
      calls.push({ kind: "command", name, ctx: handlerCtx });
      return handler(handlerCtx, command);
    };
  }
  const handlers: HandlerRegistry = {
    commands,
    message: (handlerCtx, text) => {
      calls.push({ kind: "message", name: text, ctx: handlerCtx });
      return options.message
        ? options.message(handlerCtx, text)
        : Promise.resolve({ text: `sent ${text}` });
    },
    number: (handlerCtx, numbers) => {
      calls.push({ kind: "number", name: numbers.join(","), ctx: handlerCtx });
      return Promise.resolve({ text: `number ${numbers.join(",")}` });
    },
  };
  let paused = false;
  const direct: { text: string; token: string | undefined }[] = [];
  const pause = vi.fn(() => {
    paused = true;
    return Promise.resolve();
  });
  const pipeline = new InboundPipeline({
    store: ctx.store,
    handlers,
    asks: ctx.asks,
    handles: ctx.handles,
    pager: ctx.pager,
    limits: ctx.limits,
    outbound: ctx.outbound,
    attachments: ctx.attachments,
    sessions: ctx.sessions,
    core: ctx.core,
    host: ctx.host,
    settings: () => ctx.settings,
    lang: () => "en",
    now: ctx.fake.clock.now,
    owner: () => ({ userId: OWNER_USER_ID, botId: BOT_ID }),
    paused: () => paused,
    pause,
    download: (ref, maxBytes, signal) =>
      ctx.fake.channel.downloadMedia(ref, maxBytes, signal),
    sendDirect: (text, token) => {
      direct.push({ text, token });
      return Promise.resolve();
    },
    openWhilePaused: (work) => work(),
  });
  let next = 0;
  const message = (
    overrides: Partial<ChannelInboundMessage> = {},
  ): ChannelInboundMessage => {
    next += 1;
    return {
      id: `m${next}`,
      fromUserId: OWNER_USER_ID,
      toUserId: BOT_ID,
      createdAtMs: ctx.fake.clock.now(),
      pollStartedAtMs: ctx.fake.clock.now(),
      isUserMessage: true,
      contextToken: "ctx-token",
      text: "hello",
      media: [],
      ...overrides,
    };
  };
  const deliver = async (
    messages: Partial<ChannelInboundMessage>[],
    cursor?: string,
  ) => {
    await pipeline.onMessages(messages.map(message), cursor);
    await pipeline.idle();
  };
  const texts = () => ctx.fake.channel.texts;
  return {
    ctx,
    pipeline,
    calls,
    direct,
    pause,
    setPaused: (value: boolean) => {
      paused = value;
    },
    message,
    deliver,
    texts,
  };
}

describe("acceptance", () => {
  it("drops messages that fail the checks without a reply", async () => {
    const t = setup();
    await t.deliver(
      [
        { id: "a", fromUserId: "stranger@im.wechat" },
        { id: "b", isUserMessage: false },
        { id: "c", toUserId: "other@im.bot" },
        { id: "d", groupId: "group-1" },
        { id: "" },
      ],
      "cursor-2",
    );
    expect(t.calls).toHaveLength(0);
    expect(t.texts()).toHaveLength(0);
    expect(t.ctx.store.get().cursor).toBe("cursor-2");
    expect(t.ctx.store.get().seenMessageIds).toEqual([]);
    expect(t.ctx.store.get().inbox).toEqual([]);
  });

  it("handles a duplicate message id once", async () => {
    const t = setup();
    await t.deliver([{ id: "x", text: "one" }]);
    await t.deliver([{ id: "x", text: "one" }]);
    expect(t.calls.map((call) => call.name)).toEqual(["one"]);
    expect(t.texts()).toEqual(["sent one"]);
    expect(t.ctx.store.get().inbox).toEqual([]);
  });

  it("writes cursor, seen ids and the inbox in one store write", async () => {
    const gate = deferred<CommandResult>();
    const slow = setup({ message: () => gate.promise });
    const writes = slow.ctx.fake.store.writes.plain;
    const update = vi.spyOn(slow.ctx.store, "update");
    await slow.pipeline.onMessages(
      [slow.message({ text: "a" }), slow.message({ text: "b" })],
      "cursor-9",
    );
    // The batch write, then the worker marking the first entry started.
    expect(update.mock.calls.length).toBeLessThanOrEqual(2);
    expect(slow.ctx.fake.store.writes.plain).toBeGreaterThan(writes);
    const state = slow.ctx.store.get();
    expect(state.cursor).toBe("cursor-9");
    expect(state.seenMessageIds).toEqual(["m1", "m2"]);
    expect(state.inbox.map((entry) => entry.text)).toEqual(["a", "b"]);
    gate.resolve({});
    await slow.pipeline.idle();
  });
});

describe("stale messages", () => {
  it("holds a message without a time and lists commands that were not run", async () => {
    const t = setup();
    await t.deliver([
      { text: ".new fix the build", createdAtMs: 0 },
      { text: ".status", createdAtMs: 0 },
    ]);
    expect(t.calls).toHaveLength(0);
    expect(t.texts()).toHaveLength(1);
    const reply = t.texts()[0] ?? "";
    expect(reply).toContain(".new fix the build");
    expect(reply).toContain("Not run:");
    expect(reply).toContain(".status");
    expect(reply).toContain(".y 11");
    const held = t.ctx.asks.get(11) as HeldAsk;
    expect(held.kind).toBe("held");
    expect(held.items.map((item) => item.text)).toEqual([".new fix the build"]);
    expect(held.deliveredAtMs).toBe(t.ctx.fake.clock.now());
    expect(t.ctx.store.get().inbox).toEqual([]);
  });

  it("treats a time three minutes in the future as stale", async () => {
    const t = setup();
    await t.deliver([
      { text: "later", createdAtMs: t.ctx.fake.clock.now() + 3 * 60_000 },
    ]);
    expect(t.calls).toHaveLength(0);
    expect(t.texts()[0]).toContain(".y 11");
  });

  it("answers a stale batch with one message and runs it on .y NN", async () => {
    const now = (t: ReturnType<typeof setup>) => t.ctx.fake.clock.now();
    const t = setup({
      commands: {
        approve: async (ctx, command) => {
          const ask = ctx.asks.get(Number(command.args[0]));
          if (ask?.kind !== "held") return { text: "nothing held" };
          ctx.asks.close(ask.number, "used");
          const replies: string[] = [];
          for (const item of ask.items) {
            const parsed = classify(item);
            if (!parsed) continue;
            const result = await ctx.bridge.dispatch(parsed, {
              heldConfirmed: true,
              ...(item.quotedText ? { quotedText: item.quotedText } : {}),
            });
            if (result.text) replies.push(result.text);
          }
          return { text: replies.join(" | ") };
        },
      },
    });
    const old = now(t) - STALE_MS - 60_000;
    await t.deliver([
      { text: "first", createdAtMs: old },
      { text: "second", createdAtMs: old + 1000, quotedText: "quoted" },
      { text: ".sessions", createdAtMs: old + 2000 },
    ]);
    expect(t.texts()).toHaveLength(1);
    expect(t.texts()[0]).toContain("3 message(s) arrived while offline");
    expect(t.calls).toHaveLength(0);

    await t.deliver([{ text: ".y 11" }]);
    expect(t.calls.map((call) => call.name)).toEqual([
      "approve",
      "first",
      "second",
    ]);
    const second = t.calls.find((call) => call.name === "second");
    expect(second?.ctx.heldConfirmed).toBe(true);
    expect(second?.ctx.inbound.quotedText).toBe("quoted");
    expect(t.texts()[1]).toBe("sent first | sent second");
  });

  it("runs a stale .pause and a guard command whose ask existed", async () => {
    const t = setup();
    const ask = t.ctx.asks.open({
      kind: "question",
      requestId: "q1",
      sessionId: "s1",
      projectId: "p1",
      questionnaire: { questions: [] },
      answerable: true,
    });
    expect(ask?.number).toBe(11);
    t.ctx.fake.clock.advance(STALE_MS + 60_000);
    const old = t.ctx.fake.clock.now() - STALE_MS - 30_000;
    await t.deliver([
      { text: ".d 11", createdAtMs: old },
      { text: ".pause", createdAtMs: old },
      { text: ".stop", createdAtMs: 0 },
    ]);
    expect(t.calls.map((call) => call.name)).toEqual(["reject", "pause"]);
    expect(t.texts().at(-1)).toContain("Not run:");
    expect(t.texts().at(-1)).toContain(".stop");
  });
});

describe("paused", () => {
  it("answers E-PAUSED at most once per interval and runs nothing", async () => {
    const t = setup();
    t.setPaused(true);
    await t.deliver([{ text: ".new a" }, { text: "b" }]);
    await t.deliver([{ text: "c" }]);
    expect(t.calls).toHaveLength(0);
    expect(t.texts()).toHaveLength(0);
    expect(t.direct).toEqual([
      { text: render("E-PAUSED", "en"), token: "ctx-token" },
    ]);
    expect(t.ctx.store.get().inbox).toEqual([]);
    expect(t.ctx.store.get().seenMessageIds).toHaveLength(3);
    t.ctx.fake.clock.advance(PAUSED_NOTICE_INTERVAL_MS);
    await t.deliver([{ text: "d" }]);
    expect(t.direct).toHaveLength(2);
  });

  it("drops queued entries once .pause ran on the priority lane", async () => {
    const gate = deferred<CommandResult>();
    let first = true;
    const t = setup({
      message: () => {
        if (!first) return Promise.resolve({ text: "late" });
        first = false;
        return gate.promise;
      },
      commands: {
        pause: async (ctx) => {
          await ctx.bridge.pause();
          return { text: "paused" };
        },
      },
    });
    await t.pipeline.onMessages(
      [t.message({ text: "slow" }), t.message({ text: "queued" })],
      undefined,
    );
    await t.pipeline.onMessages([t.message({ text: ".pause" })], undefined);
    await vi.waitFor(() => expect(t.pause).toHaveBeenCalled());
    gate.resolve({ text: "slow done" });
    await t.pipeline.idle();
    expect(t.calls.map((call) => call.name)).toEqual(["slow", "pause"]);
    expect(t.texts()).toEqual(["paused", "slow done"]);
    expect(t.ctx.store.get().inbox).toEqual([]);
  });
});

describe("lanes", () => {
  const current = { projectId: "p1", sessionId: "s1", usedAtMs: 0 };

  it("handles .stop and .pause first while a media download is slow", async () => {
    const download = deferred<Buffer>();
    const t = setup({ state: { current } });
    vi.spyOn(t.ctx.fake.channel, "downloadMedia").mockImplementation(
      () => download.promise,
    );
    await t.pipeline.onMessages(
      [
        t.message({
          text: "look at this",
          media: [{ kind: "image", ref: "img-1" }],
        }),
      ],
      undefined,
    );
    await t.pipeline.onMessages(
      [t.message({ text: ".stop" }), t.message({ text: ".pause" })],
      undefined,
    );
    await vi.waitFor(() =>
      expect(t.calls.map((call) => call.name)).toEqual(["stop", "pause"]),
    );
    download.resolve(Buffer.from("png"));
    await t.pipeline.idle();
    expect(t.calls.map((call) => call.name)).toEqual([
      "stop",
      "pause",
      "look at this",
    ]);
  });

  it("handles .stop first while a handler is slow", async () => {
    const gate = deferred<CommandResult>();
    const t = setup({ message: () => gate.promise, state: { current } });
    await t.pipeline.onMessages([t.message({ text: "long task" })], undefined);
    await t.pipeline.onMessages([t.message({ text: ".x" })], undefined);
    await vi.waitFor(() => expect(t.texts()).toEqual(["ran .stop"]));
    gate.resolve({ text: "done" });
    await t.pipeline.idle();
    expect(t.texts()).toEqual(["ran .stop", "done"]);
  });

  it("resolves onMessages before any download starts", async () => {
    const download = deferred<Buffer>();
    const t = setup();
    vi.spyOn(t.ctx.fake.channel, "downloadMedia").mockImplementation(
      () => download.promise,
    );
    await t.pipeline.onMessages(
      [
        t.message({
          text: undefined,
          media: [{ kind: "file", ref: "f-1", fileName: "a.pdf" }],
        }),
      ],
      undefined,
    );
    expect(t.ctx.fake.attachments.pending).toHaveLength(0);
    expect(t.ctx.store.get().inbox[0]?.media).toEqual([
      { kind: "file", ref: "f-1", fileName: "a.pdf" },
    ]);
    download.resolve(Buffer.from("pdf"));
    await t.pipeline.idle();
    expect(t.ctx.fake.attachments.pending).toHaveLength(1);
    expect(t.texts()[0]).toContain("a.pdf");
  });
});

describe("inbox replay", () => {
  const entry = (
    id: string,
    text: string,
    startedAtMs?: number,
  ): StoredInbound => ({
    id,
    createdAtMs: Date.UTC(2026, 10, 12, 8),
    pollStartedAtMs: Date.UTC(2026, 10, 12, 8),
    text,
    media: [],
    ...(startedAtMs !== undefined ? { startedAtMs } : {}),
  });

  it("re-runs only unstarted and idempotent entries", async () => {
    const at = Date.UTC(2026, 10, 12, 8);
    const t = setup({
      state: {
        inbox: [
          entry("i1", "hello again"),
          entry("i2", ".new build it", at),
          entry("i3", "plain started", at),
          entry("i4", ".status", at),
        ],
      },
    });
    await t.pipeline.resume();
    await t.pipeline.idle();
    expect(t.calls.map((call) => call.name)).toEqual(["hello again", "status"]);
    expect(t.texts()[0]).toContain(
      "2 message(s) were not finished when Pine last stopped",
    );
    expect(t.texts()[0]).toContain(".new build it");
    expect(t.texts()[0]).toContain("plain started");
    expect(t.ctx.store.get().inbox).toEqual([]);
  });
});

describe("classification and replies", () => {
  it("never sends an unknown command to the agent", async () => {
    const t = setup();
    await t.deliver([{ text: ".stauts" }]);
    expect(t.calls).toHaveLength(0);
    expect(t.texts()[0]).toContain("There is no .stauts command");
  });

  it("answers voice without a transcript, media only and quote only", async () => {
    const t = setup();
    t.ctx.fake.channel.media.set("vid", Buffer.from("video"));
    await t.deliver([
      { text: undefined, media: [{ kind: "voice", ref: "v" }] },
      { text: undefined, media: [{ kind: "video", ref: "vid" }] },
      { text: undefined, quotedText: "someone said" },
      { text: undefined, voiceTranscript: "spoken words" },
    ]);
    expect(t.texts()[0]).toBe(render("E-VOICE", "en"));
    expect(t.texts()[1]).toBe(
      render("R-ATTACH", "en", { name: "file", sizeBytes: 5 }),
    );
    expect(t.texts()[2]).toBe(render("E-QUOTE", "en"));
    expect(t.texts()[3]).toBe("sent spoken words");
    expect(t.calls.map((call) => call.kind)).toEqual(["message"]);
  });

  it("puts the digest of queued pushes in front of the reply", async () => {
    const t = setup({
      state: {
        outQueue: [
          {
            key: "result:s1",
            priority: 2,
            digest: { kind: "done", title: "Fix login" },
            queuedAtMs: 0,
          },
        ],
      },
    });
    await t.deliver([{ text: ".status" }]);
    expect(t.texts()).toHaveLength(1);
    expect(t.texts()[0]).toContain("Fix login");
    expect(t.texts()[0]?.endsWith("ran .status")).toBe(true);
    expect(t.ctx.store.get().outQueue).toEqual([]);
  });

  it("marks lists and shown cards delivered with the send time", async () => {
    const t = setup({
      commands: {
        sessions: (ctx) => {
          ctx.handles.set("session", [{ id: "s1", label: "One" }]);
          return Promise.resolve({
            text: "1 One",
            numbered: { kind: "session" },
            shown: [
              { ask: 11, full: true },
              { ask: 12, full: false },
            ],
          });
        },
      },
    });
    const approval = {
      kind: "approval" as const,
      requestId: "r1",
      sessionId: "s1",
      projectId: "p1",
      trigger: "pre-execution" as const,
      toolName: "bash",
      subjectCut: true,
      external: false,
    };
    t.ctx.asks.open(approval);
    t.ctx.asks.open({ ...approval, requestId: "r2" });
    t.ctx.fake.clock.advance(1000);
    await t.deliver([{ text: ".l" }]);
    const at = t.ctx.fake.clock.now();
    expect(t.ctx.handles.resolve("session", 1)?.id).toBe("s1");
    expect(t.ctx.handles.last()).toEqual({
      kind: "session",
      deliveredAtMs: at,
    });
    expect(t.ctx.store.get().handles.session?.rows[0]?.id).toBe("s1");
    expect(t.ctx.asks.get(11)).toMatchObject({
      shownAtMs: at,
      deliveredAtMs: at,
    });
    expect(t.ctx.asks.get(12)).toMatchObject({ deliveredAtMs: at });
    expect(t.ctx.asks.get(12)).not.toHaveProperty("shownAtMs");
  });

  it("maps thrown errors to replies", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const throwing =
      (value: Error): CommandHandler =>
      () =>
        Promise.reject(value);
    const t = setup({
      commands: {
        queue: throwing(refuse("E-TEXT")),
        rename: throwing(new Error("This session is open in another window.")),
        approve: throwing(
          new Error("This approval request is no longer pending."),
        ),
        history: throwing(new Error("disk on fire at /Users/me/secret")),
      },
      state: { current: { projectId: "p1", sessionId: "s1", usedAtMs: 0 } },
    });
    t.ctx.asks.open({
      kind: "confirm",
      command: { kind: "command", name: "delete", args: [] },
      resolved: {},
    });
    await t.deliver([
      { text: ".q text" },
      { text: ".rn new name" },
      { text: ".y 11" },
      { text: ".hi" },
    ]);
    expect(t.texts()).toEqual([
      render("E-TEXT", "en"),
      render("E-OTHERWIN", "en"),
      render("E-DONE", "en", { ask: 11 }),
      render("E-FAIL", "en"),
    ]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("refuses a command that needs a current session without one", async () => {
    const t = setup();
    await t.deliver([{ text: ".last" }]);
    expect(t.calls).toHaveLength(0);
    expect(t.texts()).toEqual([render("E-NOSESSION", "en")]);
  });

  it("invalidates a confirmation on another M command and a held batch on plain text", async () => {
    const t = setup();
    t.ctx.asks.open({
      kind: "confirm",
      command: { kind: "command", name: "delete", args: [] },
      resolved: {},
    });
    t.ctx.asks.open({ kind: "held", reason: "stale", items: [] });
    await t.deliver([{ text: ".w" }]);
    expect(t.ctx.asks.status(11)).toBe("open");
    await t.deliver([{ text: ".lang en" }]);
    expect(t.ctx.asks.status(11)).toBe("tombstone");
    expect(t.ctx.asks.status(12)).toBe("open");
    await t.deliver([{ text: "plain" }]);
    expect(t.ctx.asks.status(12)).toBe("tombstone");
  });

  it("sends a plain message without a reply as a typing indicator", async () => {
    const t = setup({ message: () => Promise.resolve({}) });
    await t.deliver([{ text: "quiet" }]);
    expect(t.texts()).toEqual([]);
    expect(t.ctx.fake.channel.typing).toEqual([true]);
  });
});
