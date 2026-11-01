import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalConfig } from "../config";
import {
  MAX_BODY_BYTES,
  type SignalServer,
  createSignalServer,
} from "../server";
import type { TurnProvider } from "../turn";

const ROOM = "a".repeat(43);
const OTHER_ROOM = "b".repeat(43);
const ORIGIN = "https://rc.aldine.cn";

const config: SignalConfig = {
  host: "127.0.0.1",
  port: 0,
  allowedOrigins: [ORIGIN],
  trustCloudflareAddress: false,
  turn: { keyId: "k", apiToken: "t", ttlSeconds: 600 },
  turnDailyLimit: 100,
};

let service: SignalServer;
let base: string;
let issued: ReturnType<typeof vi.fn>;
const streams: Array<{ close(): void }> = [];

async function start(
  overrides: Partial<SignalConfig> = {},
  turn?: TurnProvider | null,
) {
  issued = vi.fn(async () => [
    { urls: ["turn:example"], username: "u", credential: "c" },
  ]);
  service = createSignalServer({
    config: { ...config, ...overrides },
    turn:
      turn === null
        ? undefined
        : (turn ?? { issue: issued as () => Promise<never> }),
  });
  await new Promise<void>((resolve) =>
    service.server.listen(0, "127.0.0.1", resolve),
  );
  base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}/rc/v1`;
}

beforeEach(() => start());
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  await service.close();
});

/** Opens an event stream and returns the data of each event as it arrives. */
async function listen(
  room: string,
  role: string,
  headers: Record<string, string> = {},
) {
  const controller = new AbortController();
  const response = await fetch(`${base}/rooms/${room}/events?role=${role}`, {
    signal: controller.signal,
    headers,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stream = {
    response,
    close: () => controller.abort(),
    async next(): Promise<string | undefined> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (data) return data.slice(6);
          continue;
        }
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("no event")), 2000),
          ),
        ]);
        if (chunk.done) return undefined;
        buffer += decoder.decode(chunk.value);
      }
    },
  };
  streams.push(stream);
  return stream;
}

function post(room: string, role: string, body: unknown, path = "messages") {
  return fetch(`${base}/rooms/${room}/${path}?role=${role}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("signaling", () => {
  it("answers a health check", async () => {
    const response = await fetch(`${base}/health`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("relays a message from the phone to the waiting desktop", async () => {
    const host = await listen(ROOM, "host");
    const response = await post(ROOM, "client", { type: "offer", sdp: "x" });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ delivered: true });
    expect(JSON.parse((await host.next())!)).toEqual({
      type: "offer",
      sdp: "x",
    });
  });

  it("holds a message until the desktop connects", async () => {
    const response = await post(ROOM, "client", { type: "offer" });
    expect(await response.json()).toEqual({ delivered: false });
    const host = await listen(ROOM, "host");
    expect(JSON.parse((await host.next())!)).toEqual({ type: "offer" });
  });

  it("keeps rooms apart", async () => {
    const host = await listen(ROOM, "host");
    const other = await listen(OTHER_ROOM, "host");
    await post(OTHER_ROOM, "client", { for: "other" });
    expect(JSON.parse((await other.next())!)).toEqual({ for: "other" });
    await post(ROOM, "client", { for: "first" });
    expect(JSON.parse((await host.next())!)).toEqual({ for: "first" });
  });

  it("ends the older stream when the same role connects again", async () => {
    const first = await listen(ROOM, "host");
    await listen(ROOM, "host");
    expect(await first.next()).toBeUndefined();
  });

  it("rejects bad rooms, roles, bodies and methods", async () => {
    expect((await fetch(`${base}/rooms/short/events?role=host`)).status).toBe(
      400,
    );
    expect(
      (await fetch(`${base}/rooms/${ROOM}/events?role=admin`)).status,
    ).toBe(400);
    expect((await post(ROOM, "client", "not json")).status).toBe(400);
    expect((await post(ROOM, "client", [1])).status).toBe(400);
    expect(
      (await fetch(`${base}/rooms/${ROOM}/messages?role=host`)).status,
    ).toBe(405);
    expect((await fetch(`${base}/nothing`)).status).toBe(404);
  });

  it("rejects a message that is too large", async () => {
    const big = JSON.stringify({ sdp: "x".repeat(MAX_BODY_BYTES) });
    expect((await post(ROOM, "client", big)).status).toBe(413);
  });
});

describe("browser access", () => {
  it("allows the page origin and answers its preflight", async () => {
    const preflight = await fetch(
      `${base}/rooms/${ROOM}/messages?role=client`,
      {
        method: "OPTIONS",
        headers: { Origin: ORIGIN },
      },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const stream = await listen(ROOM, "host", { Origin: ORIGIN });
    expect(stream.response.headers.get("access-control-allow-origin")).toBe(
      ORIGIN,
    );
  });

  it("refuses any other page", async () => {
    const response = await fetch(`${base}/health`, {
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("TURN credentials", () => {
  it("are refused until both devices are connected", async () => {
    await listen(ROOM, "host");
    expect((await post(ROOM, "client", {}, "turn")).status).toBe(409);
    expect(issued).not.toHaveBeenCalled();
  });

  it("are issued once both are connected, and never leave a long-lived key", async () => {
    await listen(ROOM, "host");
    await listen(ROOM, "client");
    const response = await post(ROOM, "client", {}, "turn");
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      iceServers: unknown[];
      ttl: number;
    };
    expect(body.ttl).toBe(600);
    expect(JSON.stringify(body)).not.toContain("apiToken");
    expect(issued).toHaveBeenCalledTimes(1);
  });

  it("are limited per room", async () => {
    await listen(ROOM, "host");
    await listen(ROOM, "client");
    const statuses: number[] = [];
    for (let index = 0; index < 6; index++)
      statuses.push((await post(ROOM, "client", {}, "turn")).status);
    expect(statuses.slice(0, 4)).toEqual([201, 201, 201, 201]);
    expect(statuses.slice(4)).toEqual([429, 429]);
  });

  it("stop at the daily limit", async () => {
    await service.close();
    await start({ turnDailyLimit: 1 });
    await listen(ROOM, "host");
    await listen(ROOM, "client");
    expect((await post(ROOM, "client", {}, "turn")).status).toBe(201);
    expect((await post(ROOM, "client", {}, "turn")).status).toBe(429);
  });

  it("report that TURN is missing or failing", async () => {
    await service.close();
    await start({}, null);
    await listen(ROOM, "host");
    await listen(ROOM, "client");
    expect((await post(ROOM, "client", {}, "turn")).status).toBe(503);
    await service.close();
    await start({}, { issue: async () => Promise.reject(new Error("down")) });
    await listen(ROOM, "host");
    await listen(ROOM, "client");
    expect((await post(ROOM, "client", {}, "turn")).status).toBe(502);
  });
});
