// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebAccessStore, WebLoginThrottle } from "../webAccess";

const directories: string[] = [];

async function store() {
  const directory = await mkdtemp(path.join(tmpdir(), "pine-web-access-"));
  directories.push(directory);
  return path.join(directory, "web-access.json");
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("WebAccessStore", () => {
  it("stores only a hash of the password, privately, and verifies it after a reload", async () => {
    const file = await store();
    const access = new WebAccessStore(file);
    await access.load();
    expect(access.hasPassword()).toBe(false);
    await expect(access.setPassword("short")).rejects.toThrow();
    await access.setPassword("correct horse");
    expect(await readFile(file, "utf8")).not.toContain("correct horse");
    if (process.platform !== "win32")
      expect((await stat(file)).mode & 0o777).toBe(0o600);

    const reloaded = new WebAccessStore(file);
    await reloaded.load();
    expect(reloaded.hasPassword()).toBe(true);
    expect(await reloaded.verify("correct horse")).toBe(true);
    expect(await reloaded.verify("wrong horse")).toBe(false);
  });

  it("issues sessions that expire, survive restarts and end when everyone is signed out", async () => {
    const file = await store();
    const access = new WebAccessStore(file);
    await access.setPassword("correct horse");
    const now = Date.UTC(2026, 0, 1);
    const week = access.issue("7d", now);
    expect(week.maxAge).toBe(7 * 24 * 60 * 60);
    expect(access.isValid(week.value, now)).toBe(true);
    expect(access.isValid(week.value, now + 8 * 24 * 60 * 60 * 1000)).toBe(
      false,
    );
    expect(access.isValid(`${week.value}x`, now)).toBe(false);
    expect(access.isValid(`9${week.value}`, now)).toBe(false);

    const browser = access.issue("session", now);
    expect(browser.maxAge).toBeUndefined();
    expect(access.isValid(browser.value, now + 2 * 24 * 60 * 60 * 1000)).toBe(
      false,
    );

    const reloaded = new WebAccessStore(file);
    await reloaded.load();
    expect(reloaded.isValid(week.value, now)).toBe(true);
    await reloaded.signOutAll();
    expect(reloaded.isValid(week.value, now)).toBe(false);
    await reloaded.setPassword("another horse");
    expect(reloaded.isValid(reloaded.issue("1d", now).value, now)).toBe(true);
  });
});

describe("WebLoginThrottle", () => {
  it("locks a client out after repeated failures, doubling each time, without affecting others", () => {
    const throttle = new WebLoginThrottle();
    for (let attempt = 0; attempt < 4; attempt++) throttle.failed("a", 0);
    expect(throttle.retryAfter("a", 0)).toBe(0);
    throttle.failed("a", 0);
    expect(throttle.retryAfter("a", 0)).toBe(30_000);
    throttle.failed("a", 30_000);
    expect(throttle.retryAfter("a", 30_000)).toBe(60_000);
    expect(throttle.retryAfter("b", 30_000)).toBe(0);
    throttle.succeeded("a");
    expect(throttle.retryAfter("a", 30_000)).toBe(0);
  });
});
