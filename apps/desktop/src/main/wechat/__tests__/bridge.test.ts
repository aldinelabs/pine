// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WECHAT_SETTINGS,
  type WeChatStatus,
} from "../../../shared/wechatRemote";
import type { TinyFishSafeStorage } from "../../tinyfishCredentials";
import type { PineAgentEvent } from "../../../shared/agent";
import { WeChatBridge, wechatUserDigest } from "../bridge";
import type {
  ChannelBinding,
  ChannelBindingEvent,
  ChannelCredentials,
  ChannelFactory,
  ChannelHandlers,
  ChannelInboundMessage,
  MessageChannel,
} from "../channel";
import { PAIR_CODE_TTL_MS } from "../constants";
import type { CommandContext, HandlerRegistry } from "../handlers/types";
import type { WeChatBridgeOptions, WeChatHostPorts } from "../ports";
import { render } from "../replies";
import { SessionDirectory } from "../sessionDirectory";
import { WeChatStore } from "../store";
import { W, createFakeCore } from "./fakes";

/** The context the last fake `.info` ran with. */
let infoContext: CommandContext | undefined;

/** Handlers that only echo, so the bridge tests do not depend on wave-5 bodies. */
function fakeRegistry(): HandlerRegistry {
  return {
    commands: {
      status: () => Promise.resolve({ text: "ran status" }),
      // Opens a question whose card is still queued, as while offline.
      info: (ctx) => {
        infoContext = ctx;
        const ask = ctx.asks.open({
          kind: "question",
          requestId: "q1",
          sessionId: "s1",
          projectId: "p1",
          questionnaire: { questions: [] },
          answerable: true,
        });
        if (ask) {
          ctx.store.updateSoon((draft) => {
            draft.outQueue.push({
              key: `ask:${ask.number}`,
              priority: 2,
              digest: { kind: "ask", number: ask.number },
              queuedAtMs: ctx.now,
            });
          });
        }
        return Promise.resolve({ text: "opened" });
      },
      pause: async (ctx) => {
        await ctx.bridge.pause();
        return { text: "paused now" };
      },
    },
    message: (_ctx, text) => Promise.resolve({ text: `sent ${text}` }),
    number: () => Promise.resolve({}),
  };
}

class TestBridge extends WeChatBridge {
  constructor(options: WeChatBridgeOptions) {
    super(options);
  }

  protected override handlerRegistry(): HandlerRegistry {
    return fakeRegistry();
  }

  idle(): Promise<void> {
    return this.pipeline?.idle() ?? Promise.resolve();
  }
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const USER = "owner-user@im.wechat";
const BOT = "bot-1@im.bot";
const BASE_URL = "https://ilinkai.weixin.qq.com";
const CODE = "482913";
const TOKEN = "bot-token-secret";

function fakeStorage(available = true): TinyFishSafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) =>
      Buffer.from(`sealed:${Buffer.from(text).toString("hex")}`),
    decryptString: (data) => {
      const text = data.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("cannot decrypt");
      return Buffer.from(text.slice("sealed:".length), "hex").toString("utf8");
    },
  };
}

interface FakeChannel extends MessageChannel {
  credentials: ChannelCredentials;
  handlers?: ChannelHandlers;
  cursor?: string;
  sent: { to: string; token: string | undefined; text: string }[];
  stopped: boolean;
  deliver(
    messages: Partial<ChannelInboundMessage>[],
    cursor?: string,
  ): Promise<void>;
}

function fakeChannel(credentials: ChannelCredentials): FakeChannel {
  const channel: FakeChannel = {
    credentials,
    sent: [],
    stopped: false,
    start(handlers, cursor) {
      channel.handlers = handlers;
      channel.cursor = cursor;
    },
    stop() {
      channel.stopped = true;
      return Promise.resolve();
    },
    wake: vi.fn(),
    sendText(to, token, text) {
      channel.sent.push({ to, token, text });
      return Promise.resolve({ ok: true });
    },
    sendFile: vi.fn(() => Promise.resolve({ ok: true as const })),
    setTyping: vi.fn(() => Promise.resolve()),
    downloadMedia: vi.fn(() => Promise.resolve(Buffer.alloc(0))),
    deliver(messages, cursor) {
      if (!channel.handlers) throw new Error("not started");
      return channel.handlers.onMessages(
        messages.map((message, index) => ({
          id: `m-${Math.random()}-${index}`,
          fromUserId: USER,
          toUserId: BOT,
          createdAtMs: 1,
          pollStartedAtMs: 1,
          isUserMessage: true,
          contextToken: "ctx-1",
          text: "hello",
          media: [],
          ...message,
        })),
        cursor,
      );
    },
  };
  return channel;
}

interface FakeFactory extends ChannelFactory {
  binds: {
    onEvent: (event: ChannelBindingEvent) => void;
    existingToken?: string;
    handle: ChannelBinding & {
      cancel: ReturnType<typeof vi.fn>;
      submitVerifyCode: ReturnType<typeof vi.fn>;
    };
  }[];
  channels: FakeChannel[];
  allowed: boolean;
  emit(event: ChannelBindingEvent): void;
}

function fakeFactory(): FakeFactory {
  const factory: FakeFactory = {
    binds: [],
    channels: [],
    allowed: true,
    bind(onEvent, existingToken) {
      const handle = { cancel: vi.fn(), submitVerifyCode: vi.fn() };
      factory.binds.push({ onEvent, existingToken, handle });
      return handle;
    },
    open(credentials) {
      const channel = fakeChannel(credentials);
      factory.channels.push(channel);
      return channel;
    },
    allowsBaseUrl: () => factory.allowed,
    emit(event) {
      const last = factory.binds.at(-1);
      if (!last) throw new Error("no binding");
      last.onEvent(event);
    },
  };
  return factory;
}

const credentials = (userId = USER, token = TOKEN): ChannelCredentials => ({
  token,
  botId: BOT,
  userId,
  baseUrl: BASE_URL,
});

async function setup(
  options: { storage?: TinyFishSafeStorage; projects?: string[] } = {},
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "pine-wechat-bridge-"),
  );
  directories.push(directory);
  const storage = options.storage ?? fakeStorage();
  const projects = new Set(options.projects ?? []);
  const clock = { now: 1_000_000 };
  const factory = fakeFactory();
  const statuses: WeChatStatus[] = [];
  const host = {
    version: "1.0.0",
    computerName: "studio",
    locale: () => "en-US" as const,
    fetch: vi.fn(),
    credentialStorage: storage,
    dataDirectory: path.join(directory, "data"),
    agentDirectory: path.join(directory, "agent"),
    localAutomationApprovals: true,
    changed: vi.fn((status: WeChatStatus) => statuses.push(status)),
    notify: vi.fn(),
    keepAwake: vi.fn(),
  } satisfies WeChatHostPorts;
  const fakeCore = createFakeCore();
  for (const id of projects) fakeCore.addProject(id);
  const core = fakeCore.ports;
  const openStore = () =>
    new WeChatStore({
      statePath: path.join(host.agentDirectory, "wechat-remote.json"),
      securePath: path.join(host.dataDirectory, "wechat-remote-secure"),
      storage,
    });
  const bridge = new TestBridge({
    core,
    host,
    channels: factory,
    now: () => clock.now,
    randomCode: () => CODE,
  });
  return {
    bridge,
    factory,
    host,
    clock,
    statuses,
    openStore,
    directory,
    fakeCore,
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Writes a bound account to disk, as a previous run would have. */
async function seedBound(
  context: Setup,
  plain: { cursor?: string; tracked?: boolean } = {},
) {
  const store = context.openStore();
  await store.load();
  await store.updateSecure((draft) => {
    draft.token = TOKEN;
    draft.owner = { userId: USER, botId: BOT, baseUrl: BASE_URL, boundAt: 5 };
  });
  await store.update((draft) => {
    draft.cursor = plain.cursor ?? "cursor-7";
    draft.seenMessageIds = ["old-1"];
    if (plain.tracked) {
      draft.tracked = [
        {
          sessionId: "s1",
          projectId: "p1",
          origin: "wechat",
          trackedAtMs: 1,
          lastUsedAtMs: 1,
        },
      ];
      draft.current = { projectId: "p1", sessionId: "s1", usedAtMs: 1 };
      draft.origins = [
        { sessionId: "s1", projectId: "p1", kind: "started", atMs: 1 },
        { sessionId: "s2", projectId: "p1", kind: "used", atMs: 1 },
      ];
    }
  });
}

/** Runs a binding up to the pairing phase. */
async function toPairing(context: Setup) {
  await context.bridge.start();
  await context.bridge.startBinding();
  context.factory.emit({ type: "qr", content: "qr-content", expiresAtMs: 9 });
  context.factory.emit({ type: "scanned" });
  context.factory.emit({ type: "confirmed", credentials: credentials() });
  await vi.waitFor(() =>
    expect(context.bridge.status().binding?.phase).toBe("pairing"),
  );
  const channel = context.factory.channels.at(-1);
  if (!channel) throw new Error("no channel");
  return channel;
}

function noSecrets(status: WeChatStatus) {
  const text = JSON.stringify(status);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(CODE);
  expect(text).not.toContain(USER);
}

describe("WeChatBridge binding and pairing", () => {
  it("binds through the QR code and the pairing code", async () => {
    const context = await setup();
    await context.bridge.start();
    let status = await context.bridge.startBinding();
    expect(status.binding?.phase).toBe("starting");
    expect(context.factory.binds[0]?.existingToken).toBeUndefined();
    context.factory.emit({ type: "qr", content: "qr-content", expiresAtMs: 9 });
    expect(context.bridge.status().binding).toEqual({
      phase: "qr",
      qrContent: "qr-content",
      expiresAt: 9,
    });
    context.factory.emit({ type: "scanned" });
    expect(context.bridge.status().binding).toEqual({ phase: "scanned" });
    context.factory.emit({ type: "confirmed", credentials: credentials() });
    await vi.waitFor(() =>
      expect(context.bridge.status().binding?.phase).toBe("pairing"),
    );
    status = context.bridge.status();
    expect(status.bound).toBe(false);
    expect(status.binding?.pairing).toMatchObject({
      codeSent: false,
      attemptsLeft: 3,
    });
    noSecrets(status);

    const channel = context.factory.channels[0];
    if (!channel) throw new Error("no channel");
    expect(channel.cursor).toBe("");
    await channel.deliver([{ text: ".new delete everything" }], "cursor-1");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]?.to).toBe(USER);
    expect(channel.sent[0]?.text).toContain(CODE);
    expect(context.bridge.status().binding?.pairing?.codeSent).toBe(true);
    noSecrets(context.bridge.status());

    status = await context.bridge.submitPairingCode(` ${CODE} `);
    expect(status.bound).toBe(true);
    expect(status.binding).toBeUndefined();
    expect(status.paused).toBe(false);
    expect(status.owner).toEqual({
      userDigest: wechatUserDigest(USER),
      boundAt: context.clock.now,
    });
    expect(status.owner?.userDigest).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    noSecrets(status);
    expect(channel.sent).toHaveLength(2);
    expect(channel.sent[1]?.text).toContain("studio");
    expect(channel.sent[1]?.token).toBe("ctx-1");

    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().token).toBe(TOKEN);
    expect(stored.secure().owner?.userId).toBe(USER);
    expect(stored.get().cursor).toBe("cursor-1");
    expect(stored.get().seenMessageIds).toHaveLength(1);
    for (const status of context.statuses) noSecrets(status);
  });

  it("forwards nothing and sends only the code before the code is entered", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    await channel.deliver([
      { text: ".new one" },
      { text: ".y 11" },
      { text: "third" },
      { fromUserId: "stranger@im.wechat", text: "hi" },
      { groupId: "group-1" },
      { isUserMessage: false },
    ]);
    expect(channel.sent).toHaveLength(2);
    for (const sent of channel.sent) {
      expect(sent.to).toBe(USER);
      expect(sent.text).toContain(CODE);
    }
    expect(context.bridge.status().bound).toBe(false);
  });

  it("discards the token after three wrong codes", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    await context.bridge.submitPairingCode("000000");
    await context.bridge.submitPairingCode("111111");
    expect(context.bridge.status().binding?.pairing?.attemptsLeft).toBe(1);
    const status = await context.bridge.submitPairingCode("222222");
    expect(status).toMatchObject({
      bound: false,
      connection: "unbound",
      error: "pairing-failed",
    });
    expect(status.binding).toBeUndefined();
    expect(channel.stopped).toBe(true);
    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().token).toBeUndefined();
    await expect(context.bridge.submitPairingCode(CODE)).rejects.toThrow();
  });

  it("fails an expired pairing", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    context.clock.now += PAIR_CODE_TTL_MS;
    const status = await context.bridge.submitPairingCode(CODE);
    expect(status.error).toBe("pairing-failed");
    expect(status.bound).toBe(false);
    expect(channel.stopped).toBe(true);
  });

  it("binds once when the right code is submitted twice at the same time", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    const [first, second] = await Promise.all([
      context.bridge.submitPairingCode(CODE),
      context.bridge.submitPairingCode(CODE),
    ]);
    expect(first.bound).toBe(true);
    expect(second.error).toBeUndefined();
    const status = context.bridge.status();
    expect(status.bound).toBe(true);
    expect(status.error).toBeUndefined();
    expect(status.binding).toBeUndefined();
    expect(channel.stopped).toBe(false);
  });

  it("keeps a pairing that is being written when cancel comes in", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    const submitted = context.bridge.submitPairingCode(CODE);
    context.bridge.cancelBinding();
    const status = await submitted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status.bound).toBe(true);
    expect(context.bridge.status().error).toBeUndefined();
    expect(channel.stopped).toBe(false);
  });

  it("fails the pairing on cancel", async () => {
    const context = await setup();
    const channel = await toPairing(context);
    const status = context.bridge.cancelBinding();
    expect(status.error).toBe("pairing-failed");
    expect(status.binding).toBeUndefined();
    await vi.waitFor(() => expect(channel.stopped).toBe(true));
  });

  it("passes the verify code on", async () => {
    const context = await setup();
    await context.bridge.start();
    await context.bridge.startBinding();
    context.factory.emit({ type: "need-verify-code", retry: true });
    expect(context.bridge.status().binding).toEqual({
      phase: "verify-code",
      verifyRetry: true,
    });
    context.bridge.submitVerifyCode(" 42 ");
    expect(
      context.factory.binds[0]?.handle.submitVerifyCode,
    ).toHaveBeenCalledWith("42");
  });

  it("maps a failed binding to its error", async () => {
    const context = await setup();
    await context.bridge.start();
    await context.bridge.startBinding();
    context.factory.emit({ type: "failed", reason: "expired", message: "x" });
    expect(context.bridge.status()).toMatchObject({ error: "binding-expired" });
    expect(context.bridge.status().binding).toBeUndefined();
  });

  it("refuses an account other than the bound one", async () => {
    const context = await setup();
    await seedBound(context);
    context.factory.allowed = false;
    await context.bridge.start();
    expect(context.bridge.status().connection).toBe("reauth-required");
    context.factory.allowed = true;
    await context.bridge.startBinding();
    context.factory.emit({
      type: "confirmed",
      credentials: credentials("someone-else@im.wechat", "other-token"),
    });
    await vi.waitFor(() =>
      expect(context.bridge.status().error).toBe("account-mismatch"),
    );
    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().token).toBe(TOKEN);
  });

  it("refuses to bind while bound and connected", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    await expect(context.bridge.startBinding()).rejects.toThrow(
      /already connected/,
    );
    expect(context.factory.binds).toHaveLength(0);
  });

  it("re-binds the same account without pairing and keeps its sessions", async () => {
    const context = await setup();
    await seedBound(context, { tracked: true });
    await context.bridge.start();
    const first = context.factory.channels[0];
    first?.handlers?.onState("reauth-required");
    first?.handlers?.onState("reauth-required");
    expect(context.bridge.status().connection).toBe("reauth-required");
    const reauthNotices = context.host.notify.mock.calls.filter(
      ([notification]) =>
        (notification as { kind: string }).kind === "reauth-required",
    );
    expect(reauthNotices).toHaveLength(1);

    await context.bridge.startBinding();
    expect(context.factory.binds[0]?.existingToken).toBe(TOKEN);
    context.factory.emit({
      type: "confirmed",
      credentials: credentials(USER, "new-token"),
    });
    await vi.waitFor(() => expect(context.factory.channels).toHaveLength(2));
    const second = context.factory.channels[1];
    expect(first?.stopped).toBe(true);
    expect(second?.cursor).toBe("");
    expect(second?.credentials.token).toBe("new-token");
    const status = context.bridge.status();
    expect(status.binding).toBeUndefined();
    expect(status.bound).toBe(true);
    expect(status.connection).toBe("connecting");
    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().token).toBe("new-token");
    expect(stored.get()).toMatchObject({
      cursor: "",
      // Kept, so a message iLink delivers again is not run twice.
      seenMessageIds: ["old-1"],
      current: { projectId: "p1", sessionId: "s1", usedAtMs: 1 },
    });
    expect(stored.get().tracked).toHaveLength(1);
    expect(stored.get().origins).toHaveLength(2);
  });

  it("reports encryption-unavailable and does not bind", async () => {
    const context = await setup({ storage: fakeStorage(false) });
    await context.bridge.start();
    const status = await context.bridge.startBinding();
    expect(status.error).toBe("encryption-unavailable");
    expect(context.factory.binds).toHaveLength(0);
  });
});

describe("WeChatBridge lifecycle and settings", () => {
  it("connects with the stored cursor when bound", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const channel = context.factory.channels[0];
    expect(channel?.cursor).toBe("cursor-7");
    expect(channel?.credentials).toEqual(credentials());
    expect(context.bridge.isListening()).toBe(true);
    channel?.handlers?.onState("online");
    expect(context.bridge.status().connection).toBe("online");
    noSecrets(context.bridge.status());
  });

  it("advances the cursor and dedupe list for accepted messages only", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const channel = context.factory.channels[0];
    await channel?.deliver(
      [
        {
          id: "a",
          createdAtMs: context.clock.now,
          pollStartedAtMs: context.clock.now,
        },
        { id: "old-1" },
        { id: "b", fromUserId: "stranger" },
        { id: "c", toUserId: "other-bot" },
      ],
      "cursor-8",
    );
    const stored = context.openStore();
    await stored.load();
    expect(stored.get().cursor).toBe("cursor-8");
    expect(stored.get().seenMessageIds).toEqual(["old-1", "a"]);
    await context.bridge.idle();
    expect(channel?.sent.map((sent) => sent.text)).toEqual(["sent hello"]);
  });

  it("asks for a new scan when the stored base URL is no longer allowed", async () => {
    const context = await setup();
    await seedBound(context);
    context.factory.allowed = false;
    await context.bridge.start();
    expect(context.factory.channels).toHaveLength(0);
    expect(context.bridge.status().connection).toBe("reauth-required");
    expect(context.host.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reauth-required" }),
    );
  });

  it("starts paused with defaults and notifies when the sealed file is tampered with", async () => {
    const context = await setup();
    await seedBound(context);
    await writeFile(
      path.join(context.host.dataDirectory, "wechat-remote-secure"),
      "tampered",
    );
    await context.bridge.start();
    const status = context.bridge.status();
    expect(status).toMatchObject({
      paused: true,
      bound: false,
      error: "settings-reset",
      settings: DEFAULT_WECHAT_SETTINGS,
    });
    expect(context.host.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "settings-reset" }),
    );
    expect(context.factory.channels).toHaveLength(0);
  });

  it("unbinds: stops the channel, forgets the account, resets permissions", async () => {
    const context = await setup({ projects: ["p1"] });
    await seedBound(context, { tracked: true });
    await context.bridge.start();
    await context.bridge.setSettings({
      ceilingMode: "YOLO",
      allowFileSending: true,
      keepAwake: true,
      defaultProjectId: "p1",
    });
    const status = await context.bridge.unbind();
    expect(context.factory.channels[0]?.stopped).toBe(true);
    expect(status).toMatchObject({ bound: false, connection: "unbound" });
    expect(status.settings).toEqual({
      ...DEFAULT_WECHAT_SETTINGS,
      keepAwake: true,
      defaultProjectId: "p1",
    });
    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().token).toBeUndefined();
    expect(stored.get().tracked).toEqual([]);
    expect(context.host.keepAwake).toHaveBeenLastCalledWith(false);
  });

  it("keeps pause in the sealed blob", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const status = await context.bridge.setPaused(true);
    expect(status.paused).toBe(true);
    expect(context.bridge.isListening()).toBe(false);
    const stored = context.openStore();
    await stored.load();
    expect(stored.secure().paused).toBe(true);
    expect(stored.get()).not.toHaveProperty("paused");
  });

  it("clamps settings, keeps an existing default project and drops a missing one", async () => {
    const context = await setup({ projects: ["p1"] });
    await seedBound(context);
    await context.bridge.start();
    let status = await context.bridge.setSettings({
      defaultMode: "autonomous",
      ceilingMode: "autonomous",
    });
    status = await context.bridge.setSettings({ ceilingMode: "let-me-review" });
    expect(status.settings.defaultMode).toBe("let-me-review");
    status = await context.bridge.setSettings({ defaultProjectId: "p1" });
    expect(status.settings.defaultProjectId).toBe("p1");
    status = await context.bridge.setSettings({ defaultProjectId: null });
    expect(status.settings.defaultProjectId).toBeUndefined();
    status = await context.bridge.setSettings({ defaultProjectId: "gone" });
    expect(status.settings.defaultProjectId).toBeUndefined();
  });

  it("keeps the computer awake only while listening with the switch on", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    await context.bridge.setSettings({ keepAwake: true });
    expect(context.host.keepAwake).toHaveBeenLastCalledWith(true);
    await context.bridge.setPaused(true);
    expect(context.host.keepAwake).toHaveBeenLastCalledWith(false);
  });

  it("reloads paused and settings from disk", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const offline = context.openStore();
    await offline.load();
    await offline.updateSecure((draft) => {
      draft.paused = true;
      draft.settings = { ...draft.settings, allowHighRiskApprovals: true };
    });
    const status = await context.bridge.reloadLocalConfig();
    expect(status.paused).toBe(true);
    expect(status.settings.allowHighRiskApprovals).toBe(true);
  });

  it("reads the sidebar marker from the stored origins", async () => {
    const context = await setup();
    await seedBound(context, { tracked: true });
    await context.bridge.start();
    expect(context.bridge.originOf("s1")).toBe("wechat");
    expect(context.bridge.originOf("s2")).toBe("wechat-used");
    expect(context.bridge.originOf("s3")).toBeUndefined();
  });

  it("refuses a WeChat-driven session's automation run until it can check it", async () => {
    const context = await setup();
    await seedBound(context, { tracked: true });
    const store = context.openStore();
    await store.load();
    // Not composed yet: the store is loaded, the session directory is not.
    const early = new TestBridge({
      core: context.fakeCore.ports,
      host: context.host,
      channels: context.factory,
      now: () => context.clock.now,
      randomCode: () => CODE,
      store,
    });
    const automation = { id: "a1", name: "Nightly", enabled: true };
    expect(early.automationRunRefusal("s1", automation)).toContain(
      "driven from WeChat",
    );
    expect(early.automationRunRefusal("s3", automation)).toBeUndefined();

    // Composed, but the check itself throws.
    await context.bridge.start();
    const spy = vi
      .spyOn(SessionDirectory.prototype, "automationRunRefusal")
      .mockImplementation(() => {
        throw new Error("broken");
      });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(context.bridge.automationRunRefusal("s1", automation)).toContain(
        "driven from WeChat",
      );
    } finally {
      spy.mockRestore();
      errors.mockRestore();
    }
  });

  it("marks a relative a WeChat-driven session relays to, before and after composing", async () => {
    const context = await setup();
    await seedBound(context, { tracked: true });
    const store = context.openStore();
    await store.load();
    const early = new TestBridge({
      core: context.fakeCore.ports,
      host: context.host,
      channels: context.factory,
      now: () => context.clock.now,
      randomCode: () => CODE,
      store,
    });
    await early.sessionRelayed("s1", "local-parent", "p1");
    expect(early.originOf("local-parent")).toBe("wechat-used");
    // A session WeChat never drove taints nothing.
    await early.sessionRelayed("s3", "other", "p1");
    expect(early.originOf("other")).toBeUndefined();

    await context.bridge.start();
    await context.bridge.sessionRelayed("s2", "sibling", "p1");
    expect(context.bridge.originOf("sibling")).toBe("wechat-used");
  });

  it("stops the channel on stop", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    await context.bridge.stop();
    expect(context.factory.channels[0]?.stopped).toBe(true);
  });
});

describe("WeChatBridge composition", () => {
  const fresh = (context: Setup) => ({
    createdAtMs: context.clock.now,
    pollStartedAtMs: context.clock.now,
  });

  it("runs accepted messages through the pipeline and replies on the channel", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const channel = context.factory.channels[0];
    await channel?.deliver([{ text: ".status", ...fresh(context) }]);
    await context.bridge.idle();
    expect(channel?.sent).toEqual([
      { to: USER, token: "ctx-1", text: "ran status" },
    ]);
    const stored = context.openStore();
    await stored.load();
    expect(stored.get().inbox).toEqual([]);
  });

  it("answers .pause, then E-PAUSED once, and invalidates open asks", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const channel = context.factory.channels[0];
    await channel?.deliver([{ text: ".pause", ...fresh(context) }]);
    await context.bridge.idle();
    expect(context.bridge.status().paused).toBe(true);
    await channel?.deliver([{ text: "hi", ...fresh(context) }]);
    await channel?.deliver([{ text: "again", ...fresh(context) }]);
    await context.bridge.idle();
    expect(channel?.sent.map((sent) => sent.text)).toEqual([
      "paused now",
      render("E-PAUSED", "en"),
    ]);
  });

  it("withdraws queued cards of the asks a pause invalidates", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    const channel = context.factory.channels[0];
    await channel?.deliver([{ text: ".info", ...fresh(context) }]);
    await context.bridge.idle();
    const ctx = infoContext;
    expect(ctx?.store.get().outQueue.map((item) => item.key)).toEqual([
      "ask:11",
    ]);
    await context.bridge.setPaused(true);
    expect(ctx?.asks.list()).toEqual([]);
    expect(ctx?.store.get().outQueue).toEqual([]);
  });

  it("unbind aborts running sessions only the bridge holds", async () => {
    const context = await setup({ projects: ["p1", "p2"] });
    await seedBound(context);
    await context.bridge.start();
    const runtimes = context.fakeCore.runtimes;
    runtimes.addLiveSession({ sessionId: "own", projectId: "p1", clientId: W });
    runtimes.addLiveSession({
      sessionId: "shared",
      projectId: "p2",
      clientId: W,
    });
    runtimes.openProject(1, "p2");
    const running = (sessionId: string): PineAgentEvent => ({
      type: "run-state",
      sessionId,
      state: "running",
    });
    context.bridge.observeAgentEvent(running("own"), W);
    context.bridge.observeAgentEvent(running("shared"), 1);
    await context.bridge.unbind();
    expect(runtimes.abort).toHaveBeenCalledTimes(1);
    expect(runtimes.abort).toHaveBeenCalledWith(W, "own");
    expect(runtimes.dispose).toHaveBeenCalledWith(W);
  });

  it("purges mode overrides above a lowered ceiling", async () => {
    const context = await setup();
    await seedBound(context);
    const seeded = context.openStore();
    await seeded.load();
    await seeded.update((draft) => {
      draft.modeOverride = { s1: "autonomous", s2: "let-me-review" };
    });
    await context.bridge.start();
    await context.bridge.setSettings({ ceilingMode: "YOLO" });
    let stored = context.openStore();
    await stored.load();
    expect(Object.keys(stored.get().modeOverride)).toEqual(["s1", "s2"]);
    await context.bridge.setSettings({ ceilingMode: "let-me-review" });
    stored = context.openStore();
    await stored.load();
    expect(stored.get().modeOverride).toEqual({ s2: "let-me-review" });
  });

  it("never lets an observer error reach the core", async () => {
    const context = await setup();
    await seedBound(context);
    await context.bridge.start();
    expect(() =>
      context.bridge.observeAgentEvent(
        { type: "run-state" } as unknown as PineAgentEvent,
        undefined,
      ),
    ).not.toThrow();
  });
});
