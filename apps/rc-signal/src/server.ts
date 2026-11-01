import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from "node:http";
import type { SignalConfig } from "./config";
import { DailyBudget, RateLimiter } from "./rateLimit";
import { type Role, RoomHub } from "./rooms";
import type { TurnProvider } from "./turn";

export const API_PREFIX = "/rc/v1";
export const MAX_BODY_BYTES = 96 * 1024;
const ROOM_ID = /^[A-Za-z0-9_-]{43}$/;
const ROUTE = new RegExp(
  `^${API_PREFIX}/rooms/([^/]+)/(events|messages|turn)$`,
);

export interface SignalServer {
  server: Server;
  hub: RoomHub;
  close(): Promise<void>;
}

function reply(
  response: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): void {
  if (body === undefined) {
    response.writeHead(status, headers);
    response.end();
    return;
  }
  response.writeHead(status, {
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

class TooLarge extends Error {}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new TooLarge();
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createSignalServer(options: {
  config: SignalConfig;
  turn?: TurnProvider;
  now?: () => number;
}): SignalServer {
  const { config } = options;
  const now = options.now ?? Date.now;
  const hub = new RoomHub(undefined, now);
  const connections = new RateLimiter(30, 0.5);
  const posts = new RateLimiter(120, 20);
  const turnByAddress = new RateLimiter(10, 10 / 3600);
  const turnByRoom = new RateLimiter(4, 4 / 600);
  const turnBudget = new DailyBudget(config.turnDailyLimit);
  const sweeper = setInterval(() => {
    const time = now();
    hub.sweep(time);
    for (const limiter of [connections, posts, turnByAddress, turnByRoom])
      limiter.sweep(time);
  }, 30_000);
  sweeper.unref();

  function address(request: IncomingMessage): string {
    const forwarded = request.headers["cf-connecting-ip"];
    if (config.trustCloudflareAddress && typeof forwarded === "string")
      return forwarded.slice(0, 64);
    return request.socket.remoteAddress ?? "unknown";
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (!config.allowedOrigins.includes(origin)) return reply(response, 403);
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      return reply(response, 204, undefined, {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === `${API_PREFIX}/health` && request.method === "GET")
      return reply(response, 200, { ok: true });
    const match = ROUTE.exec(url.pathname);
    if (!match) return reply(response, 404, { error: "Not found." });
    const [, room, action] = match as unknown as [string, string, string];
    const role = url.searchParams.get("role");
    if (!ROOM_ID.test(room) || (role !== "host" && role !== "client"))
      return reply(response, 400, { error: "Invalid room or role." });
    const client = address(request);
    const time = now();

    if (action === "events" && request.method === "GET")
      return events(request, response, room, role, client, time);
    if (action === "messages" && request.method === "POST")
      return message(request, response, room, role, client, time);
    if (action === "turn" && request.method === "POST")
      return issueTurn(response, room, client, time);
    return reply(response, 405);
  }

  function events(
    request: IncomingMessage,
    response: ServerResponse,
    room: string,
    role: Role,
    client: string,
    time: number,
  ) {
    if (!connections.take(client, time))
      return reply(response, 429, { error: "Too many connections." });
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 3000\n\n");
    let closed = false;
    const unsubscribe = hub.subscribe(
      room,
      role,
      {
        send: (event) =>
          response.write(`id: ${event.id}\ndata: ${event.data}\n\n`),
        close: () => {
          if (!closed) response.end();
        },
      },
      time,
    );
    if (!unsubscribe) {
      response.end();
      return;
    }
    const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
    response.once("close", () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
    request.once("error", () => response.end());
  }

  async function message(
    request: IncomingMessage,
    response: ServerResponse,
    room: string,
    role: Role,
    client: string,
    time: number,
  ) {
    if (!posts.take(client, time))
      return reply(response, 429, { error: "Too many messages." });
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      return error instanceof TooLarge
        ? reply(response, 413, { error: "The message is too large." })
        : reply(response, 400, { error: "The body must be JSON." });
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return reply(response, 400, { error: "The body must be a JSON object." });
    const outcome = hub.post(room, role, JSON.stringify(body), time);
    if (outcome === "full")
      return reply(response, 503, { error: "The service is full." });
    return reply(response, 202, { delivered: outcome === "delivered" });
  }

  async function issueTurn(
    response: ServerResponse,
    room: string,
    client: string,
    time: number,
  ) {
    if (!options.turn)
      return reply(response, 503, { error: "TURN is not configured." });
    if (!hub.online(room))
      return reply(response, 409, { error: "Both devices must be connected." });
    if (!turnByAddress.take(client, time) || !turnByRoom.take(room, time))
      return reply(response, 429, { error: "Too many TURN requests." });
    if (!turnBudget.take(time))
      return reply(response, 429, { error: "TURN is at its daily limit." });
    try {
      const iceServers = await options.turn.issue();
      return reply(response, 201, {
        iceServers,
        ttl: config.turn?.ttlSeconds ?? 3600,
      });
    } catch {
      return reply(response, 502, { error: "TURN is unavailable." });
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) reply(response, 500, { error: "Failed." });
      else response.end();
    });
  });
  server.requestTimeout = 0; // event streams stay open
  server.headersTimeout = 15_000;

  return {
    server,
    hub,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweeper);
        hub.closeAll();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
