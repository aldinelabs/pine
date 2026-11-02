// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteControlStore } from "../../main/remote/rcStore";
import { formatPairing, remoteStorePath, runRemoteAction } from "../remoteCli";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pine-rc-cli-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

async function pairTwo(): Promise<void> {
  const store = new RemoteControlStore(remoteStorePath(directory));
  await store.load();
  await store.addDevice(
    new Uint8Array(65).fill(1),
    "Phone",
    new Uint8Array(32),
    1000,
  );
  await store.addDevice(
    new Uint8Array(65).fill(2),
    "Tablet",
    new Uint8Array(32),
    2000,
  );
}

describe("runRemoteAction", () => {
  it("says when nothing is paired", async () => {
    expect(await runRemoteAction(directory, { kind: "list" })).toBe(
      "No devices are paired.",
    );
  });

  it("lists paired devices with their ids", async () => {
    await pairTwo();
    const text = await runRemoteAction(directory, { kind: "list" });
    expect(text).toContain("Phone");
    expect(text).toContain("Tablet");
    expect(text).toContain("last seen never");
  });

  it("removes a device by a unique start of its id", async () => {
    await pairTwo();
    const store = new RemoteControlStore(remoteStorePath(directory));
    await store.load();
    const [phone] = store.devices();
    expect(
      await runRemoteAction(directory, {
        kind: "remove",
        id: phone.id.slice(0, 12),
      }),
    ).toContain("Removed Phone");
    await store.load();
    expect(store.devices().map((d) => d.name)).toEqual(["Tablet"]);
  });

  it("refuses an id that matches nothing or several devices", async () => {
    await pairTwo();
    await expect(
      runRemoteAction(directory, { kind: "remove", id: "zzz" }),
    ).rejects.toThrow(/No paired device/);
    await expect(
      runRemoteAction(directory, { kind: "remove", id: "" }),
    ).rejects.toThrow(/more than one/);
  });
});

describe("formatPairing", () => {
  it("shows a QR code, the link and the fingerprint", () => {
    const text = formatPairing({
      url: "https://rc.aldine.cn/#p=abc",
      expiresAt: Date.now() + 60_000,
      fingerprint: "AB12 CD34",
    });
    expect(text).toContain("https://rc.aldine.cn/#p=abc");
    expect(text).toContain("AB12 CD34");
    expect(text).toMatch(/[▀▄█]/);
  });
});
