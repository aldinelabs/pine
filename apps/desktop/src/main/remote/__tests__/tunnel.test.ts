// @vitest-environment node
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  MAX_DATA_BYTES,
  MAX_FRAME_BYTES,
  dataFrames,
  decodeFrame,
  type Frame,
} from "@pine/rc-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Tunnel, type TunnelChannel } from "../tunnel";

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

let server: Server;
let origin: string;
let seen: Seen[];
let onRequest: (request: IncomingMessage, response: ServerResponse) => void;
let tunnels: Tunnel[];

class FakeChannel implements TunnelChannel {
  frames: Frame[] = [];
  sizes: number[] = [];
  send(bytes: Uint8Array): void {
    this.sizes.push(bytes.length);
    this.frames.push(decodeFrame(bytes));
  }
  drained(): Promise<void> {
    return Promise.resolve();
  }
  of(stream: number): Frame[] {
    return this.frames.filter((frame) => frame.stream === stream);
  }
  body(stream: number): Buffer {
    return Buffer.concat(
      this.of(stream).flatMap((frame) =>
        frame.type === "data" ? [Buffer.from(frame.data)] : [],
      ),
    );
  }
}

async function until(check: () => boolean, message = "condition") {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function tunnelFor(channel: FakeChannel, extra = {}) {
  const tunnel = new Tunnel(channel, {
    origin,
    cookie: () => "pine_web_9415=signed",
    ...extra,
  });
  tunnels.push(tunnel);
  return tunnel;
}

function get(
  tunnel: Tunnel,
  stream: number,
  path: string,
  headers: Array<[string, string]> = [],
) {
  tunnel.handle({
    type: "request",
    stream,
    head: { method: "GET", path, headers },
  });
  tunnel.handle({ type: "end", stream });
}

beforeEach(async () => {
  seen = [];
  tunnels = [];
  onRequest = (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      seen.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Set-Cookie": "leak=1",
        "X-Custom": "kept",
      });
      response.end("hello");
    });
  };
  server = createServer((request, response) => onRequest(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const tunnel of tunnels) tunnel.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("Tunnel", () => {
  it("turns a request into one for the local server and streams the answer back", async () => {
    const channel = new FakeChannel();
    get(tunnelFor(channel), 1, "/api/session");
    await until(() => channel.of(1).some((frame) => frame.type === "end"));
    const [head] = channel.of(1);
    expect(head).toMatchObject({ type: "response", head: { status: 200 } });
    expect(channel.body(1).toString()).toBe("hello");
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/session" });
  });

  it("uses the pairing's cookie and the server's own Host and Origin", async () => {
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel);
    tunnel.handle({
      type: "request",
      stream: 1,
      head: {
        method: "POST",
        path: "/api/rpc",
        headers: [
          ["Cookie", "stolen=1"],
          ["Host", "evil.example"],
          ["Origin", "https://evil.example"],
          ["Referer", "https://evil.example/"],
          ["X-Forwarded-For", "6.6.6.6"],
          ["Content-Type", "application/json"],
        ],
      },
    });
    tunnel.handle({ type: "end", stream: 1 });
    await until(() => seen.length === 1);
    const headers = seen[0].headers;
    expect(headers.cookie).toBe("pine_web_9415=signed");
    expect(headers.host).toBe(new URL(origin).host);
    expect(headers.origin).toBe(origin);
    expect(headers.referer).toBeUndefined();
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("keeps the server's headers but never forwards its cookies", async () => {
    const channel = new FakeChannel();
    get(tunnelFor(channel), 1, "/x");
    await until(() => channel.of(1).some((frame) => frame.type === "end"));
    const head = channel.of(1)[0];
    if (head?.type !== "response") throw new Error("no head");
    const names = head.head.headers.map(([name]) => name);
    expect(names).toContain("x-custom");
    expect(names).not.toContain("set-cookie");
    expect(names).not.toContain("transfer-encoding");
  });

  it("delivers a request body sent in several frames", async () => {
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel);
    const body = Buffer.alloc(MAX_DATA_BYTES * 3 + 7, 3);
    tunnel.handle({
      type: "request",
      stream: 1,
      head: { method: "POST", path: "/api/upload", headers: [] },
    });
    for (const frame of dataFrames(1, body)) tunnel.handle(decodeFrame(frame));
    tunnel.handle({ type: "end", stream: 1 });
    await until(() => seen.length === 1);
    expect(seen[0].body.equals(body)).toBe(true);
  });

  it("splits a large response into frames that each fit one message", async () => {
    const big = Buffer.alloc(200_000, 9);
    onRequest = (_request, response) => {
      response.writeHead(200);
      response.end(big);
    };
    const channel = new FakeChannel();
    get(tunnelFor(channel), 1, "/big");
    await until(() => channel.of(1).some((frame) => frame.type === "end"));
    expect(channel.body(1).equals(big)).toBe(true);
    for (const size of channel.sizes)
      expect(size).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });

  it("streams a long-lived response and stops it when the phone cancels", async () => {
    let closed = false;
    onRequest = (request, response) => {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: one\n\n");
      request.socket.on("close", () => {
        closed = true;
      });
    };
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel);
    get(tunnel, 1, "/api/events");
    await until(() => channel.body(1).toString().includes("one"));
    expect(channel.of(1).some((frame) => frame.type === "end")).toBe(false);
    tunnel.handle({ type: "cancel", stream: 1 });
    await until(() => closed, "the server to see the cancel");
  });

  it("answers 502 when the local server is not reachable", async () => {
    const channel = new FakeChannel();
    const tunnel = new Tunnel(channel, {
      origin: "http://127.0.0.1:1",
      cookie: () => undefined,
    });
    tunnels.push(tunnel);
    get(tunnel, 1, "/x");
    await until(() => channel.of(1).some((frame) => frame.type === "end"));
    expect(channel.of(1)[0]).toMatchObject({
      type: "response",
      head: { status: 502 },
    });
  });

  it("starts streams past the limit once a slot frees up", async () => {
    const held: ServerResponse[] = [];
    onRequest = (request, response) => {
      if (request.url === "/hold") held.push(response);
      else response.end(request.url);
    };
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel, { maxStreams: 2 });
    get(tunnel, 1, "/hold");
    get(tunnel, 3, "/hold");
    tunnel.handle({
      type: "request",
      stream: 5,
      head: { method: "POST", path: "/queued", headers: [] },
    });
    tunnel.handle({ type: "data", stream: 5, data: new Uint8Array([1, 2]) });
    tunnel.handle({ type: "end", stream: 5 });
    get(tunnel, 7, "/cancelled");
    tunnel.handle({ type: "cancel", stream: 7 });
    await until(() => held.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(channel.of(5)).toEqual([]);

    held[0].end();
    await until(() => channel.body(5).toString() === "/queued");
    expect(channel.of(7)).toEqual([]);
    held[1].end();
  });

  it("refuses streams once the waiting line is full", async () => {
    onRequest = () => undefined; // never answers
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel, { maxStreams: 2, maxWaiting: 1 });
    for (const stream of [1, 3, 5, 7]) get(tunnel, stream, "/hold");
    await until(() => channel.of(7).length === 2);
    expect(channel.of(7)[0]).toMatchObject({
      type: "response",
      head: { status: 429 },
    });
    expect(channel.of(5)).toEqual([]);
  });

  it("ignores streams that are even or already open", async () => {
    onRequest = () => undefined;
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel);
    get(tunnel, 2, "/even");
    get(tunnel, 1, "/a");
    get(tunnel, 1, "/again");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(channel.frames).toEqual([]);
  });

  it("rejects a request body over the limit", async () => {
    onRequest = () => undefined;
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel, { maxRequestBytes: 100 });
    tunnel.handle({
      type: "request",
      stream: 1,
      head: { method: "POST", path: "/api/upload", headers: [] },
    });
    tunnel.handle({ type: "data", stream: 1, data: new Uint8Array(101) });
    await until(() => channel.of(1).some((frame) => frame.type === "end"));
    expect(channel.of(1)[0]).toMatchObject({
      type: "response",
      head: { status: 413 },
    });
  });

  it("answers a ping and stops everything on close", async () => {
    let closed = false;
    onRequest = (request, response) => {
      response.writeHead(200);
      response.write("x");
      request.socket.on("close", () => {
        closed = true;
      });
    };
    const channel = new FakeChannel();
    const tunnel = tunnelFor(channel);
    tunnel.handle({ type: "ping", stream: 9 });
    expect(channel.frames).toEqual([{ type: "pong", stream: 9 }]);
    get(tunnel, 1, "/open");
    await until(() => channel.body(1).length > 0);
    tunnel.close();
    await until(() => closed, "the server to see the close");
    const before = channel.frames.length;
    get(tunnel, 3, "/after");
    expect(channel.frames).toHaveLength(before);
  });
});
