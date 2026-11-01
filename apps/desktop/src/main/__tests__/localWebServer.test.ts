// @vitest-environment node
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalWebServer } from "../localWebServer";
import { WEB_SNAPSHOT_CHANNEL } from "../../shared/webControl";

const servers: LocalWebServer[] = [];
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
    invoke,
    asset,
    snapshots: () => [],
    resource: () => Promise.resolve(new Response("resource")),
    upload: () => Promise.resolve({ uploaded: true }),
  });
  servers.push(server);
  const status = await server.configure({
    enabled: true,
    port: await freePort(),
  });
  const url = new URL(status.url!);
  const origin = url.origin;
  const token = new URLSearchParams(url.hash.slice(1)).get("access_token");
  async function connect() {
    const response = await fetch(`${origin}/api/connect`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(response.status).toBe(204);
    return response.headers.get("set-cookie")!.split(";")[0];
  }
  const cookie = await connect();
  return { server, origin, cookie, invoke, asset, token };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => server.configure({ enabled: false, port: 9415 })),
  );
});

describe("LocalWebServer", () => {
  it("neither frames nor retains events while it is stopped", async () => {
    const server = new LocalWebServer({
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
    const status = await server.configure({
      enabled: true,
      port: await freePort(),
    });
    const url = new URL(status.url!);
    const login = await fetch(`${url.origin}/api/connect`, {
      method: "POST",
      headers: { Origin: url.origin },
      body: JSON.stringify({
        token: new URLSearchParams(url.hash.slice(1)).get("access_token"),
      }),
    });
    const controller = new AbortController();
    const events = await fetch(`${url.origin}/api/events?after=1`, {
      headers: { Cookie: login.headers.get("set-cookie")!.split(";")[0] },
      signal: controller.signal,
    });
    const { value } = await events.body!.getReader().read();
    controller.abort();
    // Nothing was retained, so a stale cursor falls back to a snapshot.
    expect(new TextDecoder().decode(value)).toContain(WEB_SNAPSHOT_CHANNEL);
  });

  it("protects both application data and static assets and rejects foreign origins and hosts", async () => {
    const { origin, cookie, asset } = await fixture();
    expect((await fetch(`${origin}/api/rpc`)).status).toBe(401);
    const connectPage = await fetch(`${origin}/`);
    expect(await connectPage.text()).toContain("access_token");
    expect(asset).not.toHaveBeenCalled();
    expect(
      (await fetch(`${origin}/`, { headers: { Cookie: cookie } })).status,
    ).toBe(200);
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
    const hostStatus = await new Promise<number | undefined>(
      (resolve, reject) => {
        const request = httpRequest(
          origin,
          { headers: { Host: "attacker.example:9415" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.once("error", reject);
        request.end();
      },
    );
    expect(hostStatus).toBe(403);
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
      first.server.configure({
        enabled: true,
        port: second.server.status().port,
      }),
    ).rejects.toThrow();
    expect(first.server.status()).toMatchObject({
      enabled: true,
      port: previous.port,
      url: previous.url,
    });
    expect(
      (await fetch(first.origin, { headers: { Cookie: first.cookie } })).status,
    ).toBe(200);
    await first.server.configure({ enabled: false, port: previous.port });
    await second.server.configure({ enabled: true, port: previous.port });
    expect(second.server.status().enabled).toBe(true);
  });
});
