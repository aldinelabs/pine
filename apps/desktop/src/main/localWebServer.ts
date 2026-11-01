import { WebRequestCache } from "./webRequestCache";
import { webConnectPage } from "./webConnectPage";
import { isWebServerSettings } from "../shared/webControl";
import { z } from "zod";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import {
  decodeWebJson,
  encodeWebJson,
  DEFAULT_WEB_PORT,
  WEB_SNAPSHOT_CHANNEL,
  type WebEvent,
  type WebServerSettings,
  type WebServerStatus,
  type WebSessionSnapshot,
} from "../shared/webControl";

const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const MAX_REPLAY_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;

interface LocalWebServerOptions {
  invoke(channel: string, request: unknown, clientId: string): Promise<unknown>;
  deduplicate?(channel: string): boolean;
  connected?(clientId: string): void;
  disconnected?(clientId: string): void;
  snapshots(): WebSessionSnapshot[];
  asset(request: Request): Promise<Response>;
  resource(request: Request): Promise<Response>;
  upload(projectId: string, name: string, bytes: Uint8Array): Promise<unknown>;
}

interface RunningServer {
  server: Server;
  sockets: Set<Socket>;
  streams: Map<ServerResponse, string>;
  token: string;
  cookie: string;
  port: number;
}

/** Browsers share cookies across ports, so each port signs in separately. */
function cookieName(port: number): string {
  return `pine_web_${port}`;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(
  request: IncomingMessage,
  limit = MAX_REQUEST_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error("The upload exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function writeResponse(
  target: ServerResponse,
  source: Response,
): Promise<void> {
  target.writeHead(source.status, Object.fromEntries(source.headers));
  const reader = source.body?.getReader();
  if (!reader) {
    target.end();
    return;
  }
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  target.once("close", cancel);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || target.destroyed) break;
      if (!target.write(value)) await once(target, "drain");
    }
    target.end();
  } finally {
    target.off("close", cancel);
    reader.releaseLock();
  }
}

/** Loopback-only, same-origin HTTP host for Pine's existing renderer. */
export class LocalWebServer {
  private running: RunningServer | null = null;
  private configuredPort = DEFAULT_WEB_PORT;
  private error?: string;
  private sequence = 0;
  private replayBytes = 0;
  private readonly replay: Array<{ id: number; frame: string }> = [];
  private readonly requests = new WebRequestCache();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LocalWebServerOptions) {}

  isRunning(): boolean {
    return this.running !== null;
  }

  status(): WebServerStatus {
    const server = this.running;
    return {
      enabled: server !== null,
      port: server?.port ?? this.configuredPort,
      ...(server
        ? {
            url: `http://127.0.0.1:${server.port}/#access_token=${server.token}`,
          }
        : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  configure(
    settings: WebServerSettings,
    beforeCommit?: () => Promise<void>,
  ): Promise<WebServerStatus> {
    if (!isWebServerSettings(settings))
      return Promise.reject(new Error("Invalid local web settings."));
    const pending = this.queue.then(() => this.apply(settings, beforeCommit));
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async apply(
    settings: WebServerSettings,
    beforeCommit?: () => Promise<void>,
  ): Promise<WebServerStatus> {
    this.error = undefined;
    if (!settings.enabled) {
      await beforeCommit?.();
      const previous = this.running;
      this.running = null;
      this.configuredPort = settings.port;
      // Signed-in browsers cannot reconnect to a new listener, so its replay is useless.
      this.replay.length = 0;
      this.replayBytes = 0;
      await this.close(previous);
      return this.status();
    }
    if (this.running?.port === settings.port) {
      await beforeCommit?.();
      return this.status();
    }
    if (!this.running) this.configuredPort = settings.port;
    const running: RunningServer = {
      server: createServer((request, response) => {
        void this.handle(running, request, response).catch(() => {
          if (!response.headersSent)
            response.writeHead(500, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({ error: "The local web request failed." }),
          );
        });
      }),
      sockets: new Set(),
      streams: new Map(),
      token: randomBytes(32).toString("hex"),
      cookie: randomBytes(32).toString("hex"),
      port: settings.port,
    };
    running.server.on("connection", (socket) => {
      running.sockets.add(socket);
      socket.on("close", () => running.sockets.delete(socket));
    });
    running.server.requestTimeout = 60_000;
    running.server.headersTimeout = 15_000;
    try {
      await new Promise<void>((resolve, reject) => {
        running.server.once("error", reject);
        running.server.listen(settings.port, "127.0.0.1", () => {
          running.server.off("error", reject);
          resolve();
        });
      });
      // Do not replace an existing listener or its credentials until the caller
      // has committed configuration. A failed save leaves existing clients connected.
      await beforeCommit?.();
    } catch (error) {
      if (running.server.listening) await this.close(running);
      this.error = error instanceof Error ? error.message : String(error);
      throw new Error(this.error);
    }
    running.server.on("error", (error) => {
      this.error = error.message;
    });
    const previous = this.running;
    this.running = running;
    this.configuredPort = settings.port;
    await this.close(previous);
    return this.status();
  }

  private async close(running: RunningServer | null): Promise<void> {
    if (!running) return;
    for (const stream of running.streams.keys()) stream.end();
    const closed = new Promise<void>((resolve) =>
      running.server.close(() => resolve()),
    );
    for (const socket of running.sockets) socket.destroy();
    await closed;
  }

  /** Events are only framed and retained while browsers can connect. */
  publish(channel: string, value: unknown): void {
    if (!this.running) return;
    const id = ++this.sequence;
    const frame = `id: ${id}\ndata: ${encodeWebJson({ channel, value } satisfies WebEvent)}\n\n`;
    this.replay.push({ id, frame });
    this.replayBytes += Buffer.byteLength(frame);
    while (this.replayBytes > MAX_REPLAY_BYTES && this.replay.length > 1) {
      this.replayBytes -= Buffer.byteLength(this.replay.shift()!.frame);
    }
    for (const stream of this.running?.streams.keys() ?? []) {
      if (stream.writableLength > MAX_PENDING_BYTES) stream.destroy();
      else stream.write(frame);
    }
  }

  private async handle(
    running: RunningServer,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Frame-Options", "DENY");
    const host = request.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const origin = `http://${host}`;
    if (request.headers.origin && request.headers.origin !== origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    if (request.method === "POST" && request.headers.origin !== origin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (url.pathname === "/api/connect" && request.method === "POST") {
      const input = JSON.parse((await readBody(request, 1024)).toString()) as {
        token?: unknown;
      };
      if (
        typeof input.token !== "string" ||
        !sameSecret(input.token, running.token)
      ) {
        response.writeHead(401);
        response.end();
        return;
      }
      response.setHeader(
        "Set-Cookie",
        `${cookieName(running.port)}=${running.cookie}; HttpOnly; SameSite=Strict; Path=/`,
      );
      response.writeHead(204);
      response.end();
      return;
    }
    const prefix = `${cookieName(running.port)}=`;
    const authenticated = (request.headers.cookie ?? "")
      .split(";")
      .some((cookie) => {
        const value = cookie.trim();
        return (
          value.startsWith(prefix) &&
          sameSecret(value.slice(prefix.length), running.cookie)
        );
      });
    if (url.pathname.startsWith("/api/") && !authenticated) {
      response.writeHead(401);
      response.end(
        JSON.stringify({
          error: "Open the browser link from Pine settings to connect.",
        }),
      );
      return;
    }
    if (!authenticated) {
      await writeResponse(response, webConnectPage());
      return;
    }
    if (url.pathname === "/api/events" && request.method === "GET") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const cursor = Number(
        request.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0,
      );
      const oldest = this.replay[0]?.id ?? this.sequence + 1;
      if (cursor > 0 && cursor >= oldest - 1 && cursor <= this.sequence) {
        for (const event of this.replay)
          if (event.id > cursor) response.write(event.frame);
      } else {
        response.write(
          `id: ${this.sequence}\ndata: ${encodeWebJson({ channel: WEB_SNAPSHOT_CHANNEL, value: this.options.snapshots() })}\n\n`,
        );
      }
      const clientId = z
        .string()
        .max(100)
        .parse(url.searchParams.get("client") ?? "default");
      this.options.connected?.(clientId);
      running.streams.set(response, clientId);
      const heartbeat = setInterval(
        () => response.write(": heartbeat\n\n"),
        15_000,
      );
      response.once("close", () => {
        clearInterval(heartbeat);
        running.streams.delete(response);
        if (![...running.streams.values()].includes(clientId))
          this.options.disconnected?.(clientId);
      });
      return;
    }
    try {
      if (url.pathname === "/api/rpc" && request.method === "POST") {
        const input = z
          .object({
            channel: z.string().min(1).max(100),
            id: z.string().min(1).max(100),
            request: z.unknown().optional(),
            client: z.string().max(100).default("default"),
          })
          .parse(decodeWebJson((await readBody(request)).toString()));
        const invoke = () =>
          this.options.invoke(input.channel, input.request, input.client);
        const result =
          this.options.deduplicate?.(input.channel) === false
            ? await invoke()
            : await this.requests.execute(
                `${input.client}:${input.id}`,
                input.channel,
                input.request,
                invoke,
              );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(encodeWebJson({ result: result ?? null }));
        return;
      }
      if (url.pathname === "/api/upload" && request.method === "POST") {
        const result = await this.options.upload(
          url.searchParams.get("projectId") ?? "",
          url.searchParams.get("name") ?? "attachment",
          await readBody(request),
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
        return;
      }
      const headers = new Headers();
      for (const name of ["range", "if-none-match", "if-modified-since"]) {
        const value = request.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const resourceRequest = new Request(url, {
        headers,
        method: request.method,
      });
      if (url.pathname.startsWith("/api/")) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405);
          response.end();
          return;
        }
        await writeResponse(
          response,
          await this.options.resource(resourceRequest),
        );
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      await writeResponse(response, await this.options.asset(resourceRequest));
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
