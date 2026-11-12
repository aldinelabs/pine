import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IlinkClient } from "../client";
import { STALE_TOKEN_PAUSE_MS } from "../constants";
import { type PollerState, startPoller } from "../poller";
import { type MockIlink, startMockIlink } from "../testing";
import type { WeixinMessage } from "../types";

const IDENTITY = { hostName: "pine", hostVersion: "1.4.2" };

let mock: MockIlink;

beforeEach(async () => {
  mock = await startMockIlink();
});

afterEach(async () => {
  await mock.close();
});

function client(): IlinkClient {
  return new IlinkClient({
    fetch: (url, init) => fetch(url, init),
    identity: IDENTITY,
    allowUrl: () => true,
    botToken: "token",
    baseUrl: mock.baseUrl,
  });
}

async function until(condition: () => boolean, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A sleep that records its delays and ends at once. */
function instantSleep(slept: number[]) {
  return (ms: number) => {
    slept.push(ms);
    return Promise.resolve();
  };
}

/** A sleep that records its delays and ends only on abort. */
function abortableSleep(slept: number[]) {
  return (ms: number, signal?: AbortSignal) => {
    slept.push(ms);
    return new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  };
}

const pollBodies = () =>
  mock.requests
    .filter((request) => request.path.endsWith("/getupdates"))
    .map(
      (request) =>
        (request.body as { get_updates_buf: string }).get_updates_buf,
    );

type Batch = {
  cursor?: string;
  messages: WeixinMessage[];
  pollStartedAtMs: number;
};

describe("startPoller", () => {
  it("announces itself, hands over batches with their cursor, and says goodbye", async () => {
    const batches: Batch[] = [];
    let clock = 5_000;
    mock.pushUserText("one");
    const poller = startPoller({
      client: client(),
      cursor: "saved",
      now: () => clock++,
      onBatch(batch) {
        batches.push(batch);
        return Promise.resolve();
      },
    });
    await until(() => batches.length >= 1);
    mock.pushUserText("two");
    await until(() => batches.some((batch) => batch.cursor === "cursor-2"));
    await poller.stop();

    const paths = mock.requests.map((request) => request.path);
    expect(paths[0]).toBe("/ilink/bot/msg/notifystart");
    expect(paths[paths.length - 1]).toBe("/ilink/bot/msg/notifystop");
    expect(batches[0]?.cursor).toBe("cursor-1");
    expect(batches[0]?.messages[0]?.item_list?.[0]?.text_item?.text).toBe(
      "one",
    );
    expect(batches[0]?.pollStartedAtMs).toBe(5_000);
    const bodies = pollBodies();
    expect(bodies[0]).toBe("saved");
    expect(bodies[1]).toBe("cursor-1");
  });

  it("keeps the old cursor when the server sends an empty one", async () => {
    const batches: Batch[] = [];
    mock.failNext("/getupdates", {
      body: { ret: 0, msgs: [{ message_id: 1 }], get_updates_buf: "" },
    });
    const poller = startPoller({
      client: client(),
      cursor: "keep",
      onBatch(batch) {
        batches.push(batch);
        return Promise.resolve();
      },
    });
    await until(() => pollBodies().length >= 2);
    await poller.stop();
    expect(batches[0]?.cursor).toBeUndefined();
    expect(batches[0]?.messages[0]?.message_id).toBe("1");
    expect(pollBodies().slice(0, 2)).toEqual(["keep", "keep"]);
  });

  it("does not poll again until onBatch resolved", async () => {
    let release: (() => void) | undefined;
    mock.pushUserText("slow");
    const poller = startPoller({
      client: client(),
      cursor: "",
      onBatch() {
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    await until(() => release !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pollBodies()).toHaveLength(1);
    release?.();
    await until(() => pollBodies().length >= 2);
    await poller.stop();
    expect(pollBodies()[1]).toBe("cursor-1");
  });

  it("backs off 2 s, 2 s, 30 s and polls the old cursor after onBatch failed", async () => {
    const slept: number[] = [];
    const states: PollerState[] = [];
    mock.failNext("/getupdates", { status: 500 });
    mock.failNext("/getupdates", { body: { ret: 1 } });
    mock.pushUserText("x");
    let calls = 0;
    const poller = startPoller({
      client: client(),
      cursor: "c0",
      sleep: instantSleep(slept),
      now: () => 0,
      onState: (state) => states.push(state),
      onBatch() {
        calls++;
        return calls === 1
          ? Promise.reject(new Error("disk full"))
          : Promise.resolve();
      },
    });
    await until(() => calls >= 2);
    await poller.stop();
    expect(slept).toEqual([2_000, 2_000, 30_000]);
    expect(pollBodies().slice(0, 4)).toEqual(["c0", "c0", "c0", "c0"]);
    expect(states[0]).toEqual({ kind: "polling" });
    expect(states).toContainEqual({
      kind: "backoff",
      untilMs: 30_000,
      error: "disk full",
    });
    expect(states[states.length - 1]).toEqual({ kind: "polling" });
  });

  it("pauses on a stale token until woken", async () => {
    const slept: number[] = [];
    const states: PollerState[] = [];
    const batches: Batch[] = [];
    mock.setStaleToken(true);
    const poller = startPoller({
      client: client(),
      cursor: "",
      now: () => 1_000,
      sleep: abortableSleep(slept),
      onState: (state) => states.push(state),
      onBatch(batch) {
        batches.push(batch);
        return Promise.resolve();
      },
    });
    await until(() => states.some((state) => state.kind === "stale-token"));
    expect(states).toContainEqual({
      kind: "stale-token",
      untilMs: 1_000 + STALE_TOKEN_PAUSE_MS,
    });
    expect(slept).toEqual([STALE_TOKEN_PAUSE_MS]);
    mock.setStaleToken(false);
    mock.pushUserText("back");
    poller.wake();
    await until(() => batches.length >= 1);
    await poller.stop();
    expect(states[states.length - 1]).toEqual({ kind: "polling" });
  });

  it("stops a running long poll at once", async () => {
    const poller = startPoller({
      client: client(),
      cursor: "",
      onBatch: () => Promise.resolve(),
    });
    await until(() => pollBodies().length >= 1);
    const started = Date.now();
    await poller.stop();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(mock.requests[mock.requests.length - 1]?.path).toBe(
      "/ilink/bot/msg/notifystop",
    );
  });
});
