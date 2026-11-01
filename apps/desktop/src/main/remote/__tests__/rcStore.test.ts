// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { toBase64Url } from "@pine/rc-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteControlStore } from "../rcStore";

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pine-rc-"));
  file = path.join(directory, "agent", "remote-control.json");
});
afterEach(() => rm(directory, { recursive: true, force: true }));

const key = (byte: number) => new Uint8Array(65).fill(byte);
const secret = (byte: number) => new Uint8Array(32).fill(byte);

async function opened(): Promise<RemoteControlStore> {
  const store = new RemoteControlStore(file);
  await store.load();
  return store;
}

describe("RemoteControlStore", () => {
  it("starts off, with no key and no phones", async () => {
    const store = await opened();
    expect(store.enabled).toBe(false);
    expect(store.devices()).toEqual([]);
    expect(store.signaling).toBe("https://api.aldine.cn");
  });

  it("makes this computer's key once and keeps it across restarts", async () => {
    const first = await opened();
    const identity = await first.hostIdentity();
    expect(await first.hostIdentity()).toBe(identity);
    const second = await opened();
    expect(toBase64Url((await second.hostIdentity()).publicKey)).toBe(
      toBase64Url(identity.publicKey),
    );
    expect(await second.hostFingerprint()).toBe(await first.hostFingerprint());
  });

  it("keeps the file private to the user", async () => {
    const store = await opened();
    await store.hostIdentity();
    if (process.platform !== "win32")
      expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("remembers phones, and forgets one when removed", async () => {
    const store = await opened();
    const device = await store.addDevice(
      key(1),
      "Kai's phone",
      secret(7),
      1000,
    );
    expect(store.isKnown(key(1))).toBe(true);
    expect(store.isKnown(key(2))).toBe(false);
    expect(store.roomSecret(device.id)).toEqual(secret(7));
    expect((await opened()).devices()).toHaveLength(1);
    await store.removeDevice(device.id);
    expect(store.isKnown(key(1))).toBe(false);
    expect(store.roomSecret(device.id)).toBeUndefined();
    expect((await opened()).devices()).toEqual([]);
  });

  it("replaces a phone that pairs again, with a new room secret", async () => {
    const store = await opened();
    await store.addDevice(key(1), "old", secret(1), 1);
    await store.addDevice(key(1), "new", secret(2), 2);
    expect(store.devices()).toHaveLength(1);
    expect(store.devices()[0]).toMatchObject({ name: "new", pairedAt: 2 });
    expect(store.roomSecret(store.devices()[0].id)).toEqual(secret(2));
  });

  it("renames phones and records when they last connected", async () => {
    const store = await opened();
    const { id } = await store.addDevice(key(1), "a", secret(1), 1);
    await store.rename(id, "Work phone");
    await store.touch(id, 99);
    expect(store.device(id)).toMatchObject({
      name: "Work phone",
      lastSeenAt: 99,
    });
  });

  it("refuses more phones than it allows, and leaves the list unchanged", async () => {
    const store = await opened();
    for (let index = 0; index < 20; index++)
      await store.addDevice(key(index + 1), `p${index}`, secret(1), 1);
    await expect(
      store.addDevice(key(99), "extra", secret(1), 1),
    ).rejects.toThrow(/Too many/);
    expect(store.devices()).toHaveLength(20);
    expect((await opened()).devices()).toHaveLength(20);
  });

  it("saves the on/off setting", async () => {
    const store = await opened();
    await store.setEnabled(true);
    expect((await opened()).enabled).toBe(true);
  });

  it("starts empty when the file is damaged", async () => {
    const store = await opened();
    await store.hostIdentity();
    await writeFile(file, "{not json");
    const reopened = await opened();
    expect(reopened.devices()).toEqual([]);
    expect(reopened.enabled).toBe(false);
  });

  it("forgets every phone when its own key cannot be read", async () => {
    const store = await opened();
    await store.hostIdentity();
    await store.addDevice(key(1), "a", secret(1), 1);
    const stored = JSON.parse(await readFile(file, "utf8"));
    stored.identity.privateKey = "AAAA";
    await writeFile(file, JSON.stringify(stored));
    const reopened = await opened();
    await reopened.hostIdentity();
    expect(reopened.devices()).toEqual([]);
  });
});
