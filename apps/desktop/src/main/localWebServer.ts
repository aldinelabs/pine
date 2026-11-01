import { WebRequestCache } from "./webRequestCache";
import { webConnectPage } from "./webConnectPage";
import { WebLoginThrottle, type WebSessionCookie } from "./webAccess";
import { isWebServerSettings } from "../shared/webControl";
import { z } from "zod";
import { once } from "node:events";
import { hostname, networkInterfaces } from "node:os";
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
  DEFAULT_WEB_SERVER_SETTINGS,
  WEB_SNAPSHOT_CHANNEL,
  type WebRememberFor,
  type WebEvent,
  type WebServerSettings,
  type WebServerStatus,
  type WebSessionSnapshot,
} from "../shared/webControl";

const MAX_REQUEST_BYTES = 36 * 1024 * 1024;
const MAX_REPLAY_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_BYTES = 2 * 1024 * 1024;

/** The password and session checks the server signs browsers in with. */
export interface WebAccess {
  hasPassword(): boolean;
  verify(password: string): Promise<boolean>;
  issue(rememberFor: WebRememberFor): WebSessionCookie;
  isValid(value: string): boolean;
}

interface LocalWebServerOptions {
  access: WebAccess;
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
  port: number;
  lan: boolean;
  requirePassword: boolean;
  publicOrigin?: string;
}

/** Browsers share cookies across ports, so each port signs in separately. */
function cookieName(port: number): string {
  return `pine_web_${port}`;
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .flatMap((address) =>
      address && address.family === "IPv4" && !address.internal
        ? [address.address]
        : [],
    );
}

/**
 * The origin pages are served from: the reverse proxy's when it forwards its
 * own Host header, otherwise this computer's. Any other Host, which DNS
 * rebinding would produce, has none, and LAN access alone accepts this
 * computer's network addresses and name.
 */
function originFor(host: string, running: RunningServer): string | undefined {
  if (running.publicOrigin && host === new URL(running.publicOrigin).host)
    return running.publicOrigin;
  return isOwnHost(host, running.lan) ? `http://${host}` : undefined;
}

function isOwnHost(host: string, lan: boolean): boolean {
  const match = /^([^:]+):\d+$/.exec(host);
  if (!match) return false;
  const name = match[1].toLowerCase();
  if (name === "127.0.0.1" || name === "localhost") return true;
  if (!lan) return false;
  const computer = hostname()
    .toLowerCase()
    .replace(/\.local$/, "");
  return (
    name === computer ||
    name === `${computer}.local` ||
    lanAddresses().includes(name)
  );
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

/**
 * Same-origin HTTP host for Pine's existing renderer. It serves this computer
 * only unless LAN access is on, and every browser signs in with the password
 * unless a reverse proxy in front of it handles sign-in.
 */
export class LocalWebServer {
  private running: RunningServer | null = null;
  private settings: WebServerSettings = DEFAULT_WEB_SERVER_SETTINGS;
  private error?: string;
  private readonly throttle = new WebLoginThrottle();
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
      ...this.settings,
      enabled: server !== null,
      hasPassword: this.options.access.hasPassword(),
      ...(server
        ? {
            addresses: [
              ...["127.0.0.1", ...(server.lan ? lanAddresses() : [])].map(
                (address) => `http://${address}:${server.port}/`,
              ),
              ...(server.publicOrigin ? [`${server.publicOrigin}/`] : []),
            ],
          }
        : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  /** Ends every open event stream; their browsers must sign in again. */
  signOutAll(): void {
    for (const stream of this.running?.streams.keys() ?? []) stream.end();
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
      this.settings = settings;
      // Signed-in browsers cannot reconnect to a new listener, so its replay is useless.
      this.replay.length = 0;
      this.replayBytes = 0;
      await this.close(previous);
      return this.status();
    }
    if (settings.requirePassword && !this.options.access.hasPassword())
      throw new Error("Set a browser access password first.");
    if (
      this.running?.port === settings.port &&
      this.running.lan === settings.lan
    ) {
      await beforeCommit?.();
      this.settings = settings;
      // Sign-in and the proxy origin apply to the next request; nothing restarts.
      this.running.requirePassword = settings.requirePassword;
      this.running.publicOrigin = settings.publicOrigin;
      return this.status();
    }
    if (!this.running) this.settings = { ...settings, enabled: false };
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
      port: settings.port,
      lan: settings.lan,
      requirePassword: settings.requirePassword,
      publicOrigin: settings.publicOrigin,
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
        running.server.listen(
          settings.port,
          settings.lan ? "0.0.0.0" : "127.0.0.1",
          () => {
            running.server.off("error", reject);
            resolve();
          },
        );
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
    this.settings = settings;
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

  private async login(
    running: RunningServer,
    origin: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const client = request.socket.remoteAddress ?? "unknown";
    const wait = this.throttle.retryAfter(client);
    if (wait > 0) {
      response.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(wait / 1000)),
      });
      response.end(JSON.stringify({ retryAfter: Math.ceil(wait / 1000) }));
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse((await readBody(request, 4096)).toString());
    } catch {
      body = undefined;
    }
    const input = z.object({ password: z.string().max(1_024) }).safeParse(body);
    if (
      !input.success ||
      !(await this.options.access.verify(input.data.password))
    ) {
      this.throttle.failed(client);
      response.writeHead(401);
      response.end();
      return;
    }
    this.throttle.succeeded(client);
    const cookie = this.options.access.issue(this.settings.rememberFor);
    response.setHeader(
      "Set-Cookie",
      `${cookieName(running.port)}=${cookie.value}; HttpOnly; SameSite=Strict; Path=/${
        cookie.maxAge === undefined ? "" : `; Max-Age=${cookie.maxAge}`
      }${origin.startsWith("https:") ? "; Secure" : ""}`,
    );
    response.writeHead(204);
    response.end();
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
    const origin = originFor(request.headers.host ?? "", running);
    if (
      !origin ||
      (request.headers.origin && request.headers.origin !== origin)
    ) {
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
    if (
      url.pathname === "/api/login" &&
      request.method === "POST" &&
      running.requirePassword
    ) {
      await this.login(running, origin, request, response);
      return;
    }
    const prefix = `${cookieName(running.port)}=`;
    // Without a password, whatever stands in front of Pine signs people in.
    const authenticated =
      !running.requirePassword ||
      (request.headers.cookie ?? "").split(";").some((cookie) => {
        const value = cookie.trim();
        return (
          value.startsWith(prefix) &&
          this.options.access.isValid(value.slice(prefix.length))
        );
      });
    if (url.pathname.startsWith("/api/") && !authenticated) {
      response.writeHead(401);
      response.end(
        JSON.stringify({ error: "Sign in with the browser access password." }),
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
