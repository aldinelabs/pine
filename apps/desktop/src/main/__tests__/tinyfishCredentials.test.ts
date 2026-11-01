// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) =>
    value.toString("utf8").replace(/^encrypted:/u, ""),
  ),
  encryptString: vi.fn((value: string) =>
    Buffer.from(`encrypted:${value}`, "utf8"),
  ),
  isEncryptionAvailable: vi.fn(() => true),
}));

import { TinyFishCredentialStore } from "../tinyfishCredentials";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("TinyFishCredentialStore", () => {
  beforeEach(() => {
    safeStorageMock.decryptString.mockClear();
    safeStorageMock.encryptString.mockClear();
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
  });

  it("persists an encrypted key and reloads it without exposing plaintext on disk", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pine-tinyfish-credentials-"),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "tinyfish-api-key");
    const store = new TinyFishCredentialStore(filePath, safeStorageMock);

    await store.load();
    expect(store.isConfigured()).toBe(false);

    await store.setApiKey("  tinyfish-secret  ");
    expect(store.getApiKey()).toBe("tinyfish-secret");
    expect(store.isConfigured()).toBe(true);
    expect(await readFile(filePath, "utf8")).not.toContain("tinyfish-secret");

    const reloaded = new TinyFishCredentialStore(filePath, safeStorageMock);
    await reloaded.load();
    expect(reloaded.getApiKey()).toBe("tinyfish-secret");
    expect(safeStorageMock.decryptString).toHaveBeenCalled();
  });

  it("refuses to write a key when OS secure storage is unavailable", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "pine-tinyfish-credentials-"),
    );
    temporaryDirectories.push(directory);
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
    const store = new TinyFishCredentialStore(
      path.join(directory, "tinyfish-api-key"),
      safeStorageMock,
    );

    await expect(store.setApiKey("tinyfish-secret")).rejects.toThrow(
      "operating system secure credential store is unavailable",
    );
  });
});
