import { mkdtemp, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectFileWatcherRegistry } from "../projectFileWatcher";

describe("ProjectFileWatcherRegistry", () => {
  let root: string;
  let registry: ProjectFileWatcherRegistry;
  let changes: Array<{
    senderId: number;
    folders: Array<{
      folderId: string;
      projectId: string;
      changedDirs: string[];
    }>;
  }>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pine-watch-"));
    changes = [];
    registry = new ProjectFileWatcherRegistry(
      async (_senderId, _projectId, _folderId, relativePath) =>
        realpath(path.resolve(root, relativePath)),
      (senderId, folders) => changes.push({ senderId, folders }),
      { changeDebounceMs: 30 },
    );
  });

  afterEach(async () => {
    registry.dispose();
    await rm(root, { recursive: true, force: true });
  });

  async function waitForChange(): Promise<void> {
    for (let i = 0; i < 100 && changes.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(changes.length).toBeGreaterThan(0);
  }

  it("reports changes in watched directories", async () => {
    await registry.setWatchedDirectories(1, {
      folders: [{ folderId: "f1", projectId: "p1", directories: [""] }],
    });
    await writeFile(path.join(root, "new.txt"), "data");
    await waitForChange();
    expect(changes.at(-1)?.senderId).toBe(1);
    expect(changes.at(-1)?.folders).toEqual([
      { folderId: "f1", projectId: "p1", changedDirs: [""] },
    ]);
  }, 10_000);

  it("replaces the watch set for a folder and drops removed folders", async () => {
    const sub = path.join(root, "sub");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(sub);
    await registry.setWatchedDirectories(1, {
      folders: [{ folderId: "f1", projectId: "p1", directories: ["", "sub"] }],
    });
    // Full-state sync without "f1" closes its watchers; changes are ignored.
    await registry.setWatchedDirectories(1, { folders: [] });
    await writeFile(path.join(root, "after.txt"), "data");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toEqual([]);
  }, 10_000);

  it("is safe to dispose twice", async () => {
    await registry.setWatchedDirectories(1, {
      folders: [{ folderId: "f1", projectId: "p1", directories: [""] }],
    });
    registry.dispose();
    expect(() => registry.dispose()).not.toThrow();
  });

  it("does not commit an older overlapping watch update", async () => {
    let releaseResolution: (() => void) | undefined;
    const resolutionBlocked = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    registry.dispose();
    registry = new ProjectFileWatcherRegistry(
      async (_senderId, _projectId, _folderId, relativePath) => {
        await resolutionBlocked;
        return realpath(path.resolve(root, relativePath));
      },
      (senderId, folders) => changes.push({ senderId, folders }),
      { changeDebounceMs: 30 },
    );

    const staleUpdate = registry.setWatchedDirectories(1, {
      folders: [{ folderId: "f1", projectId: "p1", directories: [""] }],
    });
    await registry.setWatchedDirectories(1, { folders: [] });
    releaseResolution?.();
    await staleUpdate;
    await writeFile(path.join(root, "stale.txt"), "data");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toEqual([]);
  }, 10_000);

  it("does not install watchers after the sender is disposed", async () => {
    let releaseResolution: (() => void) | undefined;
    const resolutionBlocked = new Promise<void>((resolve) => {
      releaseResolution = resolve;
    });
    registry.dispose();
    registry = new ProjectFileWatcherRegistry(
      async () => {
        await resolutionBlocked;
        return realpath(root);
      },
      (senderId, folders) => changes.push({ senderId, folders }),
      { changeDebounceMs: 30 },
    );

    const pendingUpdate = registry.setWatchedDirectories(1, {
      folders: [{ folderId: "f1", projectId: "p1", directories: [""] }],
    });
    registry.disposeSender(1);
    releaseResolution?.();
    await pendingUpdate;
    await writeFile(path.join(root, "disposed.txt"), "data");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).toEqual([]);
  }, 10_000);
});
