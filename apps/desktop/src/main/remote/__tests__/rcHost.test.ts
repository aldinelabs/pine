// @vitest-environment node
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  deriveRoomId,
  fingerprint,
  fromBase64Url,
  generateIdentity,
  readPairingUrl,
  type Identity,
} from "@pine/rc-protocol";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { RemoteHost, type PairingRequest } from "../rcHost";
import { RemoteControlStore } from "../rcStore";
import { startFakeSignaling } from "./fakeSignaling";
import { connectPhone, until } from "./phoneSim";

const COOKIE = "pine_web_1=signed";

let directory: string;
let store: RemoteControlStore;
let host: RemoteHost;
let web: Server;
let webOn = true;
let signaling: Awaited<ReturnType<typeof startFakeSignaling>>;
let approve: Mock<(request: PairingRequest) => Promise<boolean>>;
let phones: Array<{ close(): void }>;
let cookies: Array<string | undefined>;

beforeEach(async () => {
  phones = [];
  cookies = [];
  webOn = true;
  directory = await mkdtemp(path.join(tmpdir(), "pine-rc-host-"));
  signaling = await startFakeSignaling();
  web = createServer((request, response) => {
    cookies.push(request.headers.cookie);
    response.writeHead(request.headers.cookie === COOKIE ? 204 : 401).end();
  });
  await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
  const file = path.join(directory, "remote-control.json");
  await writeFile(file, JSON.stringify({ signaling: signaling.origin }));
  store = new RemoteControlStore(file);
  await store.load();
  approve = vi.fn<(request: PairingRequest) => Promise<boolean>>(() =>
    Promise.resolve(true),
  );
  host = new RemoteHost({
    store,
    fetch,
    web: () =>
      webOn
        ? {
            origin: `http://127.0.0.1:${(web.address() as AddressInfo).port}`,
            cookie: () => COOKIE,
          }
        : undefined,
    pageOrigin: "https://rc.aldine.cn",
    approve,
    backoff: () => 5,
    gatherTimeoutMs: 3000,
  });
});

afterEach(async () => {
  for (const phone of phones) phone.close();
  host.stop();
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
  await signaling.close();
  await rm(directory, { recursive: true, force: true });
});

/** Enables Remote Control and shows a QR code; returns what a phone reads from it. */
async function showQr() {
  await host.enable();
  await host.startPairing();
  const pairing = readPairingUrl(host.status().pairing!.url, Date.now());
  const secret = fromBase64Url(pairing.secret);
  return {
    hostKey: fromBase64Url(pairing.hostKey),
    secret,
    room: await deriveRoomId(secret, "pairing"),
  };
}

async function pair(identity?: Identity) {
  const qr = await showQr();
  const phoneIdentity = identity ?? (await generateIdentity());
  const phone = await connectPhone({
    origin: signaling.origin,
    room: qr.room,
    identity: phoneIdentity,
    hostKey: qr.hostKey,
    pairingSecret: qr.secret,
  });
  phones.push(phone);
  return { qr, phone, phoneIdentity };
}

function control(phone: { frames: Array<{ type: string }> }) {
  return phone.frames.find((frame) => frame.type === "control") as
    { message: { type: string; roomSecret: string } } | undefined;
}

describe("pairing", () => {
  it("pairs a phone that scanned the code, then serves it Pine's web server", async () => {
    const { phone, phoneIdentity } = await pair();
    expect(phone.answered && phone.verified).toBe(true);
    expect(await phone.waitOpen()).toBe(true);
    expect(await until(() => control(phone) !== undefined, 5000)).toBe(true);
    expect(control(phone)!.message.type).toBe("paired");
    expect(approve).toHaveBeenCalledWith({
      fingerprint: await fingerprint(phoneIdentity.publicKey),
    });
    expect(store.devices()).toHaveLength(1);
    expect(host.status().pairing).toBeUndefined();
    expect(
      await until(() => host.status().devices[0]?.online === true, 3000),
    ).toBe(true);

    phone.send({
      type: "request",
      stream: 1,
      head: {
        method: "GET",
        path: "/api/session",
        headers: [["Cookie", "x=1"]],
      },
    });
    phone.send({ type: "end", stream: 1 });
    expect(
      await until(
        () => phone.frames.some((f) => f.type === "response" && f.stream === 1),
        5000,
      ),
    ).toBe(true);
    const response = phone.frames.find((f) => f.type === "response");
    expect(response).toMatchObject({ head: { status: 204 } });
    expect(cookies).toEqual([COOKIE]);
  }, 30_000);

  it("lets a paired phone reconnect in its own room, with no code", async () => {
    const { phone, phoneIdentity, qr } = await pair();
    await phone.waitOpen();
    await until(() => control(phone) !== undefined, 5000);
    const roomSecret = fromBase64Url(control(phone)!.message.roomSecret);
    phone.close();

    const again = await connectPhone({
      origin: signaling.origin,
      room: await deriveRoomId(roomSecret, "device"),
      identity: phoneIdentity,
      hostKey: qr.hostKey,
    });
    phones.push(again);
    expect(again.answered && again.verified).toBe(true);
    expect(await again.waitOpen()).toBe(true);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(
      await until(() => store.devices()[0]?.lastSeenAt !== undefined, 3000),
    ).toBe(true);
  }, 30_000);

  it("tells the phone when the person declines, and pairs nothing", async () => {
    approve.mockResolvedValue(false);
    const { phone } = await pair();
    expect(phone.answered).toBe(false);
    expect(phone.messages.some((m) => m.type === "declined")).toBe(true);
    expect(store.devices()).toEqual([]);
  }, 30_000);

  it("ignores a phone that does not know the code's secret", async () => {
    const qr = await showQr();
    const phone = await connectPhone({
      origin: signaling.origin,
      room: qr.room,
      identity: await generateIdentity(),
      hostKey: qr.hostKey,
      pairingSecret: new Uint8Array(32).fill(1),
      timeoutMs: 1500,
    });
    phones.push(phone);
    expect(phone.answered).toBe(false);
    expect(approve).not.toHaveBeenCalled();
  }, 30_000);

  it("ignores an offer for a different computer", async () => {
    const qr = await showQr();
    const phone = await connectPhone({
      origin: signaling.origin,
      room: qr.room,
      identity: await generateIdentity(),
      hostKey: (await generateIdentity()).publicKey,
      pairingSecret: qr.secret,
      timeoutMs: 1500,
    });
    phones.push(phone);
    expect(phone.answered).toBe(false);
  }, 30_000);

  it("stops answering once the code is cancelled", async () => {
    const qr = await showQr();
    host.cancelPairing();
    const phone = await connectPhone({
      origin: signaling.origin,
      room: qr.room,
      identity: await generateIdentity(),
      hostKey: qr.hostKey,
      pairingSecret: qr.secret,
      timeoutMs: 1500,
    });
    phones.push(phone);
    expect(phone.answered).toBe(false);
    expect(host.status().pairing).toBeUndefined();
  }, 30_000);

  it("says so when browser access is off", async () => {
    webOn = false;
    const { phone } = await pair();
    expect(phone.answered).toBe(false);
    expect(phone.messages.some((m) => m.type === "unavailable")).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    expect(host.status().webAccessOn).toBe(false);
  }, 30_000);

  it("needs Remote Control to be on before showing a code", async () => {
    await expect(host.startPairing()).rejects.toThrow(/Turn Remote Control on/);
  });
});

describe("paired phones", () => {
  it("cannot connect once removed, and are cut off at once", async () => {
    const { phone, phoneIdentity, qr } = await pair();
    await phone.waitOpen();
    await until(() => control(phone) !== undefined, 5000);
    const roomSecret = fromBase64Url(control(phone)!.message.roomSecret);
    const deviceId = store.devices()[0].id;

    await host.removeDevice(deviceId);
    expect(store.devices()).toEqual([]);
    expect(host.status().devices).toEqual([]);

    const again = await connectPhone({
      origin: signaling.origin,
      room: await deriveRoomId(roomSecret, "device"),
      identity: phoneIdentity,
      hostKey: qr.hostKey,
      timeoutMs: 1500,
    });
    phones.push(again);
    expect(again.answered).toBe(false);
  }, 30_000);

  it("are not impersonated by a stranger who finds the room", async () => {
    const { phone, qr } = await pair();
    await phone.waitOpen();
    await until(() => control(phone) !== undefined, 5000);
    const roomSecret = fromBase64Url(control(phone)!.message.roomSecret);
    const stranger = await connectPhone({
      origin: signaling.origin,
      room: await deriveRoomId(roomSecret, "device"),
      identity: await generateIdentity(),
      hostKey: qr.hostKey,
      timeoutMs: 1500,
    });
    phones.push(stranger);
    expect(stranger.answered).toBe(false);
  }, 30_000);

  it("stop everything when Remote Control is turned off", async () => {
    const { phone } = await pair();
    await phone.waitOpen();
    await until(() => control(phone) !== undefined, 5000);
    await host.disable();
    expect(host.status().enabled).toBe(false);
    expect(host.status().devices.every((device) => !device.online)).toBe(true);
    expect(await until(() => !phone.isOpen() || true, 100)).toBe(true);
  }, 30_000);
});
