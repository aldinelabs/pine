// @vitest-environment node
import {
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePreviewTarget } from "../../shared/projectFiles";
import { FilePreviewWatcherRegistry } from "../filePreviewWatcher";

describe("FilePreviewWatcherRegistry", () => {
  let root: string;
  let filePath: string;
  let registry: FilePreviewWatcherRegistry;
  const changed = vi.fn();
  const project: FilePreviewTarget = {
    source: "project",
    projectId: "p1",
    folderId: "f1",
    relativePath: "report.md",
  };
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "pine-preview-watch-"));
    filePath = path.join(root, "report.md");
    await writeFile(filePath, "before");
    changed.mockClear();
    registry = new FilePreviewWatcherRegistry(
      async () => realpath(filePath),
      changed,
      20,
    );
  });
  afterEach(async () => {
    registry.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it.each(["project", "presented"] as const)(
    "tracks repeated in-place writes for %s files without a tree",
    async (source) => {
      const target =
        source === "project" ? project : { source, path: filePath };
      await registry.setWatchedPreview(1, { watchId: "tab", target });
      for (const text of ["after!", "again!"]) {
        changed.mockClear();
        await writeFile(filePath, text);
        await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(1, "tab"));
      }
    },
  );

  it("survives atomic replacement, deletion and recreation", async () => {
    await registry.setWatchedPreview(1, { watchId: "tab", target: project });
    const replacement = path.join(root, "replacement.md");
    await writeFile(replacement, "atomic");
    await rename(replacement, filePath);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await rm(filePath);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await writeFile(filePath, "recreated");
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("detects same-size writes even when mtime is restored", async () => {
    const before = await stat(filePath);
    await registry.setWatchedPreview(1, { watchId: "tab", target: project });
    await writeFile(filePath, "after!");
    await utimes(filePath, before.atime, before.mtime);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it("ignores reads and changes to sibling files", async () => {
    await registry.setWatchedPreview(1, { watchId: "tab", target: project });
    await readFile(filePath);
    await writeFile(path.join(root, "sibling.md"), "other");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(changed).not.toHaveBeenCalled();
  });

  it("removes only the requested subscription and disposes the sender", async () => {
    await registry.setWatchedPreview(1, { watchId: "a", target: project });
    await registry.setWatchedPreview(2, { watchId: "b", target: project });
    await registry.setWatchedPreview(1, { watchId: "a", target: null });
    await writeFile(filePath, "changed");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(2, "b"));
    expect(changed).not.toHaveBeenCalledWith(1, "a");
    registry.disposeSender(2);
    changed.mockClear();
    await writeFile(filePath, "after disposal");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(changed).not.toHaveBeenCalled();
  });

  it.each(["remove", "dispose", "replace"] as const)(
    "does not install a pending subscription after %s",
    async (action) => {
      let release!: (value: string) => void;
      registry.dispose();
      registry = new FilePreviewWatcherRegistry(
        vi
          .fn()
          .mockImplementationOnce(
            () =>
              new Promise<string>((resolve) => {
                release = resolve;
              }),
          )
          .mockResolvedValue(filePath),
        changed,
        20,
      );
      const pending = registry.setWatchedPreview(1, {
        watchId: "tab",
        target: project,
      });
      if (action === "dispose") registry.disposeSender(1);
      else
        await registry.setWatchedPreview(1, {
          watchId: "tab",
          target: action === "remove" ? null : project,
        });
      release(filePath);
      await pending;
      await writeFile(filePath, "changed");
      if (action === "replace") {
        await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(changed).not.toHaveBeenCalled();
      }
    },
  );

  it("rejects targets the resolver does not authorize", async () => {
    registry.dispose();
    registry = new FilePreviewWatcherRegistry(
      () => Promise.reject(new Error("not authorized")),
      changed,
      20,
    );
    await expect(
      registry.setWatchedPreview(1, { watchId: "tab", target: project }),
    ).rejects.toThrow("not authorized");
    await writeFile(filePath, "changed");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(changed).not.toHaveBeenCalled();
  });
});
