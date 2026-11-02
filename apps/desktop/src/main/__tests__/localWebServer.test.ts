// @vitest-environment node
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LocalWebServer } from "../localWebServer";
import { WebAccessStore } from "../webAccess";
import {
  DEFAULT_WEB_SERVER_SETTINGS,
  WEB_SNAPSHOT_CHANNEL,
  type WebServerSettings,
} from "../../shared/webControl";

const PASSWORD = "correct horse";
const servers: LocalWebServer[] = [];
let directory: string;
let access: WebAccessStore;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pine-web-server-"));
  access = new WebAccessStore(path.join(directory, "web-access.json"));
  await access.setPassword(PASSWORD);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

function settings(patch: Partial<WebServerSettings>): WebServerSettings {
  return { ...DEFAULT_WEB_SERVER_SETTINGS, ...patch };
}

function hostRequest(
  origin: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(origin, { headers, method }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("error", reject);
    request.end();
  });
}

async function login(origin: string, password = PASSWORD) {
  return fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}
async function freePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Missing port.");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

async function fixture() {
  const invoke = vi.fn().mockResolvedValue({ accepted: true });
  const asset = vi.fn().mockResolvedValue(new Response("renderer"));
  const server = new LocalWebServer({
    access,
    invoke,
    asset,
    snapshots: () => [],
    resource: () => Promise.resolve(new Response("resource")),
    upload: () => Promise.resolve({ uploaded: true }),
  });
  servers.push(server);
  const status = await server.configure(
    settings({ enabled: true, port: await freePort() }),
  );
  const origin = new URL(status.addresses![0]).origin;
  const response = await login(origin);
  expect(response.status).toBe(204);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { server, origin, cookie, invoke, asset };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => server.configure(settings({ enabled: false }))),
  );
});

describe("LocalWebServer", () => {
  it("gives a Remote Control tunnel a way in that the server's own checks accept", async () => {
    const { server, invoke } = await fixture();
    const way = server.loopbackAccess()!;
    expect(way.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const call = (cookie?: string) =>
      fetch(`${way.origin}/api/rpc`, {
        method: "POST",
        headers: {
          Origin: way.origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ channel: "ping", id: "1", request: {} }),
      });
    expect((await call()).status).toBe(401);
    expect((await call(way.cookie())).status).toBe(200);
    expect(invoke).toHaveBeenCalledWith("ping", {}, "default");
  });

  it("offers no way in while it is stopped", () => {
    const server = new LocalWebServer({
      access,
      invoke: vi.fn(),
      asset: vi.fn(),
      snapshots: () => [],
      resource: vi.fn(),
      upload: vi.fn(),
    });
    expect(server.loopbackAccess()).toBeUndefined();
  });

  it("neither frames nor retains events while it is stopped", async () => {
    const server = new LocalWebServer({
      access,
      invoke: vi.fn(),
      asset: vi.fn(),
      snapshots: () => [],
      resource: vi.fn(),
      upload: vi.fn(),
    });
    servers.push(server);
    const stringify = vi.spyOn(JSON, "stringify");
    for (let index = 0; index < 50; index++)
      server.publish("sessions:event", { index });
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
    const status = await server.configure(
      settings({ enabled: true, port: await freePort() }),
    );
    const origin = new URL(status.addresses![0]).origin;
    const signedIn = await login(origin);
    const controller = new AbortController();
    const events = await fetch(`${origin}/api/events?after=1`, {
      headers: { Cookie: signedIn.headers.get("set-cookie")!.split(";")[0] },
      signal: controller.signal,
    });
    const { value } = await events.body!.getReader().read();
    controller.abort();
    // Nothing was retained, so a stale cursor falls back to a snapshot.
    expect(new TextDecoder().decode(value)).toContain(WEB_SNAPSHOT_CHANNEL);
  });

  it("serves the renderer to sign in with, protects application data and rejects foreign origins and hosts", async () => {
    const { origin, cookie, asset } = await fixture();
    expect((await fetch(`${origin}/api/rpc`)).status).toBe(401);
    expect((await fetch(`${origin}/api/session`)).status).toBe(401);
    expect(
      (await fetch(`${origin}/api/session`, { headers: { Cookie: cookie } }))
        .status,
    ).toBe(204);
    expect(await (await fetch(`${origin}/`)).text()).toBe("renderer");
    expect(asset).toHaveBeenCalledOnce();
    expect(
      (
        await fetch(`${origin}/api/rpc`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: "https://example.com" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${origin}/api/rpc`, {
          method: "POST",
          headers: { Cookie: cookie },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(await hostRequest(origin, { Host: "attacker.example:9415" })).toBe(
      403,
    );
  });

  it("signs in with the password, remembers it for the chosen time and throttles guesses", async () => {
    const { server, origin } = await fixture();
    expect((await login(origin, "wrong password")).status).toBe(401);
    const week = await login(origin);
    expect(week.headers.get("set-cookie")).toMatch(
      /HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800$/,
    );
    await server.configure({ ...server.status(), rememberFor: "session" });
    expect((await login(origin)).headers.get("set-cookie")).not.toContain(
      "Max-Age",
    );
    for (let attempt = 0; attempt < 5; attempt++)
      await login(origin, "wrong password");
    const locked = await login(origin);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("refuses to start without a password unless sign-in is handled elsewhere", async () => {
    const server = new LocalWebServer({
      access: {
        hasPassword: () => false,
        verify: () => Promise.resolve(false),
        issue: () => ({ value: "" }),
        isValid: () => false,
      },
      invoke: vi.fn().mockResolvedValue({ accepted: true }),
      asset: vi.fn().mockResolvedValue(new Response("renderer")),
      snapshots: () => [],
      resource: vi.fn(),
      upload: vi.fn(),
    });
    servers.push(server);
    const port = await freePort();
    await expect(
      server.configure(settings({ enabled: true, port })),
    ).rejects.toThrow("password");
    const status = await server.configure(
      settings({
        enabled: true,
        port,
        requirePassword: false,
        publicOrigin: "https://pine.example.com",
      }),
    );
    expect(status.addresses).toEqual([
      `http://127.0.0.1:${port}/`,
      "https://pine.example.com/",
    ]);
    const origin = `http://127.0.0.1:${port}`;
    expect(await (await fetch(origin)).text()).toBe("renderer");
    // A tunnel that forwards its own Host is accepted with its own origin.
    expect(
      await hostRequest(
        origin,
        { Host: "pine.example.com", Origin: "https://pine.example.com" },
        "POST",
      ),
    ).not.toBe(403);
    expect(
      await hostRequest(
        origin,
        { Host: "pine.example.com", Origin: `http://pine.example.com` },
        "POST",
      ),
    ).toBe(403);
    expect(await hostRequest(origin, { Host: "other.example" })).toBe(403);
  });

  it("deduplicates accepted commands and rejects reuse of an ID with different input", async () => {
    const { origin, cookie, invoke } = await fixture();
    const post = (message: string) =>
      fetch(`${origin}/api/rpc`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
        body: JSON.stringify({
          id: "same-command",
          channel: "sessions:prompt",
          request: { message },
        }),
      });
    const [first, retry] = await Promise.all([post("hello"), post("hello")]);
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(invoke).toHaveBeenCalledOnce();
    expect((await post("different")).status).toBe(400);
  });

  it("sends a snapshot initially and replays events from a reconnect cursor", async () => {
    const { server, origin, cookie } = await fixture();
    const response = await fetch(`${origin}/api/events`, {
      headers: { Cookie: cookie },
    });
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain(WEB_SNAPSHOT_CHANNEL);
    server.publish("sessions:event", { state: "running" });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain(
      '"running"',
    );
    await reader.cancel();
    server.publish("sessions:event", { state: "idle" });
    const reconnect = await fetch(`${origin}/api/events`, {
      headers: { Cookie: cookie, "Last-Event-ID": "1" },
    });
    const replay = reconnect.body!.getReader();
    const frame = new TextDecoder().decode((await replay.read()).value);
    expect(frame).toContain('"idle"');
    expect(frame).not.toContain('"running"');
    await replay.cancel();
  });

  it("keeps the existing service on a port conflict and releases the port on disable", async () => {
    const first = await fixture();
    const second = await fixture();
    const previous = first.server.status();
    await expect(
      first.server.configure(
        settings({ enabled: true, port: second.server.status().port }),
      ),
    ).rejects.toThrow();
    expect(first.server.status()).toMatchObject({
      enabled: true,
      port: previous.port,
      addresses: previous.addresses,
    });
    expect(
      (await fetch(first.origin, { headers: { Cookie: first.cookie } })).status,
    ).toBe(200);
    await first.server.configure(
      settings({ enabled: false, port: previous.port }),
    );
    await second.server.configure(
      settings({ enabled: true, port: previous.port }),
    );
    expect(second.server.status().enabled).toBe(true);
  });
});
