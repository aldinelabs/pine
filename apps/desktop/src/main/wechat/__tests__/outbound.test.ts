// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_WECHAT_SETTINGS } from "../../../shared/wechatRemote";
import type { ChannelSendResult, MessageChannel } from "../channel";
import {
  MERGE_WINDOW_MS,
  OUT_QUEUE_MAX,
  REPLY_MAX,
  USABLE,
} from "../constants";
import { Outbound, type OutboundDeps, type OutboundPush } from "../outbound";
import type {
  DigestItem,
  WeChatPersistedState,
  WeChatSecureState,
  WeChatStateStore,
} from "../types";

function memoryStore(): WeChatStateStore {
  let state: WeChatPersistedState = {
    version: 1,
    language: "auto",
    cursor: "",
    seenMessageIds: [],
    inbox: [],
    pendingAttachments: [],
    tracked: [],
    origins: [],
    handles: {},
    nextAsk: 11,
    modeOverride: {},
    outQueue: [],
  };
  let secure: WeChatSecureState = {
    version: 1,
    settings: DEFAULT_WECHAT_SETTINGS,
    paused: false,
  };
  const apply = (mutate: (draft: WeChatPersistedState) => void) => {
    const draft = structuredClone(state);
    mutate(draft);
    state = draft;
  };
  return {
    load: () => Promise.resolve("ok"),
    get: () => state,
    update: (mutate) => {
      apply(mutate);
      return Promise.resolve();
    },
    updateSoon: apply,
    flush: () => Promise.resolve(),
    canEncrypt: () => true,
    secure: () => secure,
    updateSecure: (mutate) => {
      const draft = structuredClone(secure);
      mutate(draft);
      secure = draft;
      return Promise.resolve();
    },
    reloadSecure: () => Promise.resolve("ok"),
    clearBinding: () => Promise.resolve(),
  };
}

interface Sent {
  to: string;
  token: string | undefined;
  text: string;
}

function fakeChannel() {
  const sent: Sent[] = [];
  const files: string[] = [];
  const typing: boolean[] = [];
  let next: ChannelSendResult[] = [];
  const channel: MessageChannel = {
    start: () => undefined,
    stop: () => Promise.resolve(),
    wake: () => undefined,
    sendText: (to, token, text) => {
      sent.push({ to, token, text });
      return Promise.resolve(next.shift() ?? { ok: true });
    },
    sendFile: (_to, _token, file) => {
      files.push(file.name);
      return Promise.resolve(next.shift() ?? { ok: true });
    },
    setTyping: (_to, _token, on) => {
      typing.push(on);
      return Promise.resolve();
    },
    downloadMedia: () => Promise.reject(new Error("unused")),
  };
  return {
    channel,
    sent,
    files,
    typing,
    failNext: (...results: ChannelSendResult[]) => {
      next = results;
    },
  };
}

function renderDigest(items: DigestItem[]): string {
  return `DIGEST ${items
    .map((item) => ("number" in item ? `ask ${item.number}` : item.kind))
    .join(", ")}`;
}

function setup(overrides: Partial<OutboundDeps> = {}) {
  const store = memoryStore();
  const fake = fakeChannel();
  const delivered: [string, number][] = [];
  const reauth = vi.fn();
  const outbound = new Outbound({
    channel: () => fake.channel,
    ownerUserId: () => "owner@im.wechat",
    store,
    now: () => Date.now(),
    renderDigest,
    renderBudgetNotice: () => "BUDGET",
    renderMoreCards: (n) => `MORE ${n}`,
    onDelivered: (key, atMs) => delivered.push([key, atMs]),
    onReauthRequired: reauth,
    ...overrides,
  });
  return { store, outbound, delivered, reauth, ...fake };
}

function card(n: number): OutboundPush {
  return {
    key: `ask:${n}`,
    priority: 1,
    text: `CARD ${n}`,
    digest: { kind: "ask", number: n },
  };
}

function result(sessionId: string, title = sessionId): OutboundPush {
  return {
    key: `result:${sessionId}`,
    priority: 2,
    text: `DONE ${title}`,
    digest: { kind: "done", title },
  };
}

/** Lets the merge window pass and the serial sends settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(MERGE_WINDOW_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Outbound replies", () => {
  it("sends with the token, counts the send and resolves with its time", async () => {
    const t = setup();
    expect(t.outbound.onInbound("ctx-1")).toBeUndefined();
    expect(t.outbound.remaining()).toBe(USABLE);
    await expect(t.outbound.reply("hello")).resolves.toBe(1_000_000);
    expect(t.sent).toEqual([
      { to: "owner@im.wechat", token: "ctx-1", text: "hello" },
    ]);
    expect(t.outbound.remaining()).toBe(USABLE - 1);
  });

  it("appends the budget notice on the last slot, once per token", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.sent = USABLE - 1;
    });
    await t.outbound.reply("last");
    expect(t.sent.at(-1)?.text).toBe("last\n\nBUDGET");
    expect(t.store.get().contextToken?.budgetNoticeSent).toBe(true);
    await expect(t.outbound.reply("more")).resolves.toBeUndefined();
    expect(t.sent).toHaveLength(1);
    t.outbound.onInbound("ctx-2");
    expect(t.store.get().contextToken).toMatchObject({
      value: "ctx-2",
      sent: 0,
      budgetNoticeSent: false,
    });
  });

  it("marks the token exhausted after a failed send: no retry storm", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.failNext({ ok: false, reason: "rejected", code: -2 });
    await expect(t.outbound.reply("a")).resolves.toBeUndefined();
    expect(t.outbound.remaining()).toBe(0);
    await t.outbound.reply("b");
    t.outbound.push(card(11));
    t.outbound.push(result("s1"));
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual(["a"]);
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual([
      "ask:11",
      "result:s1",
    ]);
  });

  it("treats a thrown send as a failure", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.channel.sendText = () => Promise.reject(new Error("offline"));
    await expect(t.outbound.reply("a")).resolves.toBeUndefined();
    expect(t.outbound.remaining()).toBe(0);
  });

  it("stops sending after reauth-required until the next inbound", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.failNext({ ok: false, reason: "reauth-required", code: -14 });
    await t.outbound.reply("a");
    expect(t.reauth).toHaveBeenCalledOnce();
    expect(t.outbound.remaining()).toBe(0);
    await t.outbound.reply("b");
    t.outbound.push(card(12));
    await settle();
    await expect(
      t.outbound.sendFile({ name: "f.txt", data: Buffer.from("x") }),
    ).resolves.toEqual({ ok: false, reason: "reauth-required" });
    t.outbound.setTyping(true);
    expect(t.sent).toHaveLength(1);
    expect(t.typing).toEqual([]);
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual(["ask:12"]);
    expect(t.outbound.onInbound("ctx-2")).toBe("DIGEST ask 12");
    await t.outbound.reply("c");
    expect(t.sent).toHaveLength(2);
  });

  it("sends nothing without a channel or an owner", async () => {
    const t = setup({ channel: () => undefined });
    t.outbound.onInbound("ctx-1");
    await expect(t.outbound.reply("a")).resolves.toBeUndefined();
    expect(t.outbound.remaining()).toBe(USABLE);
  });
});

describe("Outbound pushes", () => {
  it("merges up to three cards and the results raised within the window", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.outbound.push(card(11));
    await vi.advanceTimersByTimeAsync(500);
    t.outbound.push(result("s1"));
    t.outbound.push(card(12));
    t.outbound.push(card(13));
    t.outbound.push(card(14));
    expect(t.sent).toHaveLength(0);
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual([
      "CARD 11\n\nCARD 12\n\nCARD 13\n\nDONE s1\n\nMORE 1",
    ]);
    expect(t.delivered.map(([key]) => key)).toEqual([
      "ask:11",
      "ask:12",
      "ask:13",
      "result:s1",
    ]);
    expect(
      t.delivered.every(([, at]) => at === 1_000_000 + MERGE_WINDOW_MS),
    ).toBe(true);
    expect(t.outbound.remaining()).toBe(USABLE - 1);
  });

  it("queues cards beyond the limit when it cannot name them", async () => {
    const t = setup({ renderMoreCards: undefined });
    t.outbound.onInbound("ctx-1");
    for (const n of [11, 12, 13, 14]) t.outbound.push(card(n));
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual([
      "CARD 11\n\nCARD 12\n\nCARD 13",
    ]);
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual(["ask:14"]);
  });

  it("keeps every merged message within REPLY_MAX", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    const long = (push: OutboundPush, size: number): OutboundPush => ({
      ...push,
      text: `${push.text} ${"字".repeat(size)}`,
    });
    for (const n of [11, 12, 13]) t.outbound.push(long(card(n), 500));
    for (const id of ["s1", "s2", "s3"]) {
      t.outbound.push(long(result(id), 300));
    }
    await settle();
    for (const sent of t.sent) {
      expect(Array.from(sent.text).length).toBeLessThanOrEqual(REPLY_MAX);
    }
    expect(t.sent[0]?.text).toMatch(/^CARD 11 /);
    expect(t.sent[0]?.text).toContain("CARD 13");
    const delivered = t.delivered.map(([key]) => key);
    expect(delivered).toEqual([
      "ask:11",
      "ask:12",
      "ask:13",
      "result:s1",
      "result:s2",
      "result:s3",
    ]);
    expect(t.sent).toHaveLength(2);
  });

  it("names the cards that do not fit with T-MORECARDS", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    for (const n of [11, 12, 13]) {
      t.outbound.push({ ...card(n), text: `CARD ${n} ${"字".repeat(800)}` });
    }
    await settle();
    expect(t.sent).toHaveLength(1);
    const text = t.sent[0]?.text ?? "";
    expect(Array.from(text).length).toBeLessThanOrEqual(REPLY_MAX);
    expect(text).toContain("CARD 12");
    expect(text).not.toContain("CARD 13");
    expect(text.endsWith("MORE 1")).toBe(true);
    expect(t.delivered.map(([key]) => key)).toEqual(["ask:11", "ask:12"]);
  });

  it("starts a new message after the window", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.outbound.push(card(11));
    await settle();
    t.outbound.push(card(12));
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual(["CARD 11", "CARD 12"]);
  });

  it("keeps the latest push of a key and honours a retraction", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.outbound.push(result("s1", "first"));
    t.outbound.push(result("s1", "second"));
    t.outbound.push(card(11));
    t.outbound.retract("ask:11");
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual(["DONE second"]);
  });

  it("applies the priority thresholds and spends the last slot on T-BUDGET", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    const progress: OutboundPush = {
      key: "progress:s1",
      priority: 3,
      text: "PROGRESS",
      digest: { kind: "done", title: "unused" },
    };
    const autorun: OutboundPush = {
      key: "autorun:a",
      priority: 4,
      text: "AUTORUN",
      digest: { kind: "autorun", name: "a", result: "ok" },
    };
    // 4 left: P3 needs 5, P4 needs 4.
    t.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.sent = USABLE - 4;
    });
    t.outbound.push(progress);
    t.outbound.push(autorun);
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual(["AUTORUN"]);
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual(["progress:s1"]);
    // 3 left: a card still goes, then 2: another card, then 1: budget notice.
    t.outbound.push(card(11));
    await settle();
    t.outbound.push(card(12));
    await settle();
    expect(t.outbound.remaining()).toBe(1);
    t.outbound.push(card(13));
    await settle();
    t.outbound.push(card(14));
    await settle();
    expect(t.sent.map((s) => s.text)).toEqual([
      "AUTORUN",
      "CARD 11",
      "CARD 12",
      "BUDGET",
    ]);
    expect(t.outbound.remaining()).toBe(0);
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual([
      "progress:s1",
      "ask:13",
      "ask:14",
    ]);
  });

  it("flushes the queue as one digest on the next inbound", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.sent = USABLE;
    });
    t.outbound.push(card(11));
    t.outbound.push(result("s1"));
    await settle();
    t.outbound.retract("ask:11");
    expect(t.outbound.onInbound("ctx-2")).toBe("DIGEST done");
    expect(t.store.get().outQueue).toEqual([]);
    expect(t.outbound.onInbound("ctx-3")).toBeUndefined();
  });

  it("keeps the queue bounded", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.sent = USABLE;
    });
    for (let n = 11; n < 11 + OUT_QUEUE_MAX + 5; n += 1) {
      t.outbound.push(card(n));
    }
    await settle();
    expect(t.store.get().outQueue).toHaveLength(OUT_QUEUE_MAX);
    expect(t.sent).toHaveLength(0);
  });

  it("queues waiting pushes on dispose", () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.outbound.push(card(11));
    t.outbound.dispose();
    t.outbound.push(card(12));
    expect(t.store.get().outQueue.map((q) => q.key)).toEqual([
      "ask:11",
      "ask:12",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Outbound files and typing", () => {
  it("sends a file within the budget and counts it", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    await expect(
      t.outbound.sendFile({ name: "a.txt", data: Buffer.from("a") }),
    ).resolves.toEqual({ ok: true });
    expect(t.files).toEqual(["a.txt"]);
    expect(t.outbound.remaining()).toBe(USABLE - 1);
    t.store.updateSoon((draft) => {
      if (draft.contextToken) draft.contextToken.sent = USABLE;
    });
    await expect(
      t.outbound.sendFile({ name: "b.txt", data: Buffer.from("b") }),
    ).resolves.toEqual({ ok: false, reason: "rejected" });
    expect(t.files).toEqual(["a.txt"]);
  });

  it("marks the token exhausted after a failed file send", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.failNext({ ok: false, reason: "network" });
    await t.outbound.sendFile({ name: "a.txt", data: Buffer.from("a") });
    expect(t.outbound.remaining()).toBe(0);
  });

  it("sets typing and ignores its failures", async () => {
    const t = setup();
    t.outbound.onInbound("ctx-1");
    t.outbound.setTyping(true);
    t.channel.setTyping = () => Promise.reject(new Error("no ticket"));
    t.outbound.setTyping(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.typing).toEqual([true]);
  });
});
