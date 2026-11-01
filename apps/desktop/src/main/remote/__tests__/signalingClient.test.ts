// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SignalingRoom, type SignalingState } from "../signalingClient";

const ROOM = "r".repeat(43);

let server: Server;
let origin: string;
let streams: ServerResponse[];
let posts: Array<{ url: string; body: string }>;
let turnStatus: number;
let rooms: SignalingRoom[];

async function until(check: () => boolean, what = "condition") {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function room(
  overrides: Partial<ConstructorParameters<typeof SignalingRoom>[0]> = {},
) {
  const messages: Array<Record<string, unknown>> = [];
  const states: SignalingState[] = [];
  const instance = new SignalingRoom({
    origin,
    room: ROOM,
    role: "host",
    fetch,
    onMessage: (message) => messages.push(message),
    onState: (state) => states.push(state),
    backoff: () => 5,
    ...overrides,
  });
  rooms.push(instance);
  return { instance, messages, states };
}

beforeEach(async () => {
  streams = [];
  posts = [];
  rooms = [];
  turnStatus = 201;
  server = createServer((request: IncomingMessage, response) => {
    void (async () => {
      const url = request.url ?? "";
      if (request.method === "GET" && url.includes("/events")) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write("retry: 3000\n\n");
        streams.push(response);
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      posts.push({ url, body });
      if (url.includes("/turn")) {
        response.writeHead(turnStatus, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            iceServers: [
              { urls: ["turn:example"], username: "u", credential: "c" },
            ],
          }),
        );
        return;
      }
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ delivered: true }));
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const instance of rooms) instance.stop();
  for (const stream of streams) stream.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("SignalingRoom", () => {
  it("passes on what the peer sends and ignores anything that is not a JSON object", async () => {
    const { instance, messages } = room();
    instance.start();
    await until(() => streams.length === 1, "the stream");
    streams[0].write('id: 1\ndata: {"type":"offer"}\n\n');
    streams[0].write("id: 2\ndata: not json\n\n");
    streams[0].write("id: 3\ndata: [1,2]\n\n");
    streams[0].write(": ping\n\n");
    streams[0].write('id: 4\ndata: {"type":"candidate"}\n\n');
    await until(() => messages.length === 2, "two messages");
    expect(messages).toEqual([{ type: "offer" }, { type: "candidate" }]);
  });

  it("handles an event split across reads", async () => {
    const { instance, messages } = room();
    instance.start();
    await until(() => streams.length === 1);
    streams[0].write('id: 1\ndata: {"type":');
    await new Promise((resolve) => setTimeout(resolve, 30));
    streams[0].write('"offer"}\n\n');
    await until(() => messages.length === 1);
    expect(messages[0]).toEqual({ type: "offer" });
  });

  it("reconnects after the stream drops", async () => {
    const { instance, messages, states } = room();
    instance.start();
    await until(() => streams.length === 1);
    streams[0].destroy();
    await until(() => streams.length === 2, "a second stream");
    streams[1].write('id: 1\ndata: {"type":"again"}\n\n');
    await until(() => messages.length === 1);
    expect(states).toContain("open");
    expect(
      states.filter((state) => state === "connecting").length,
    ).toBeGreaterThan(1);
  });

  it("reconnects when the stream goes quiet", async () => {
    const { instance } = room({ heartbeatTimeoutMs: 60 });
    instance.start();
    await until(() => streams.length === 1);
    await until(() => streams.length === 2, "a reconnect after silence");
  });

  it("stops for good when stopped", async () => {
    const { instance, states } = room();
    instance.start();
    await until(() => streams.length === 1);
    instance.stop();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(streams).toHaveLength(1);
    expect(states.at(-1)).toBe("closed");
  });

  it("posts messages to its room as its role", async () => {
    const { instance } = room({ role: "client" });
    expect(await instance.send({ type: "offer" })).toEqual({ delivered: true });
    expect(posts[0].url).toBe(`/rc/v1/rooms/${ROOM}/messages?role=client`);
    expect(JSON.parse(posts[0].body)).toEqual({ type: "offer" });
  });

  it("fails a send the service did not accept", async () => {
    const { instance } = room({
      fetch: () => Promise.resolve(new Response("no", { status: 429 })),
    });
    await expect(instance.send({})).rejects.toThrow(/429/);
  });

  it("asks for relay servers, and does without them when it cannot get any", async () => {
    const { instance } = room();
    expect(await instance.turn()).toEqual([
      { urls: ["turn:example"], username: "u", credential: "c" },
    ]);
    turnStatus = 409;
    expect(await instance.turn()).toBeUndefined();
    const offline = room({
      fetch: () => Promise.reject(new Error("offline")),
    });
    expect(await offline.instance.turn()).toBeUndefined();
  });
});
