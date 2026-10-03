import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PineProjectFolder } from "../../shared/projects";
import { isValidHostProjectEntryName } from "../fileNames";
import {
  isCaseOnlyRename,
  operateProjectFile,
  resolveProjectEntry,
  resolveProjectEntryForNativeDrag,
} from "../projectFileOperations";

const directories: string[] = [];
async function folder(): Promise<PineProjectFolder> {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "pine-file-operations-")),
  );
  directories.push(root);
  return {
    id: crypto.randomUUID(),
    access: "read-write",
    isAvailable: true,
    name: "project",
    path: root,
  };
}
const native = {
  trash: vi.fn(() => Promise.resolve()),
  open: vi.fn(() => Promise.resolve("")),
  reveal: vi.fn(),
  copyPath: vi.fn(),
};
const PROJECT_ID = "00000000-0000-4000-8000-0000000000aa";
const ref = (folder: PineProjectFolder, relativePath = "") => ({
  folderId: folder.id,
  projectId: PROJECT_ID,
  relativePath,
});
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project file operations", () => {
  it("validates Windows reserved names without rejecting portable dotfiles", () => {
    expect(isValidHostProjectEntryName(".gitignore", "win32")).toBe(true);
    for (const name of [
      "CON",
      "con.txt",
      "report.",
      "report ",
      "a:b.txt",
      "a?.txt",
    ]) {
      expect(isValidHostProjectEntryName(name, "win32")).toBe(false);
    }
    expect(isValidHostProjectEntryName("a:b.txt", "darwin")).toBe(true);
  });

  it("detects Windows case-only renames", () => {
    expect(
      isCaseOnlyRename(
        "C:\\Project\\Readme.md",
        "c:\\project\\README.md",
        "win32",
      ),
    ).toBe(true);
    expect(
      isCaseOnlyRename("/Project/Readme.md", "/Project/README.md", "darwin"),
    ).toBe(false);
  });

  it("resolves native drag paths without allowing symlink escapes", async () => {
    const root = await folder();
    await writeFile(path.join(root.path, "notes.md"), "notes");
    expect(
      resolveProjectEntryForNativeDrag([root], ref(root, "notes.md")),
    ).toBe(path.join(root.path, "notes.md"));
    await expect(
      resolveProjectEntry([root], ref(root, "../outside")),
    ).rejects.toThrow("outside");
  });

  it("creates, renames, and moves files and directories", async () => {
    const root = await folder();
    await operateProjectFile(
      [root],
      { action: "create", target: ref(root), name: "docs", kind: "directory" },
      native,
    );
    await operateProjectFile(
      [root],
      { action: "create", target: ref(root), name: "notes.md", kind: "file" },
      native,
    );
    await writeFile(path.join(root.path, "notes.md"), "notes");
    await operateProjectFile(
      [root],
      { action: "rename", target: ref(root, "notes.md"), name: "readme.md" },
      native,
    );
    await operateProjectFile(
      [root],
      {
        action: "move",
        target: ref(root, "docs"),
        sources: [ref(root, "readme.md")],
      },
      native,
    );
    expect(await readFile(path.join(root.path, "docs/readme.md"), "utf8")).toBe(
      "notes",
    );
    await expect(stat(path.join(root.path, "readme.md"))).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("moves external files and folders, removing their original locations", async () => {
    const root = await folder();
    const external = await folder();
    await mkdir(path.join(external.path, "images"));
    await writeFile(path.join(external.path, "images/photo.png"), "image");
    await writeFile(path.join(external.path, "notes.md"), "notes");
    await operateProjectFile(
      [root],
      {
        action: "move-external",
        target: ref(root),
        paths: [
          path.join(external.path, "images"),
          path.join(external.path, "notes.md"),
        ],
      },
      native,
    );
    expect(
      await readFile(path.join(root.path, "images/photo.png"), "utf8"),
    ).toBe("image");
    expect(await readFile(path.join(root.path, "notes.md"), "utf8")).toBe(
      "notes",
    );
    await expect(
      stat(path.join(external.path, "images")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preflights batch collisions and preserves both existing content and all sources", async () => {
    const root = await folder();
    await mkdir(path.join(root.path, "dest"));
    for (const name of ["a", "b", "dest/b"])
      await writeFile(path.join(root.path, name), name);
    await expect(
      operateProjectFile(
        [root],
        {
          action: "move",
          target: ref(root, "dest"),
          sources: [ref(root, "a"), ref(root, "b")],
        },
        native,
      ),
    ).rejects.toThrow("already exists");
    expect(await readFile(path.join(root.path, "a"), "utf8")).toBe("a");
    expect(await readFile(path.join(root.path, "dest/b"), "utf8")).toBe(
      "dest/b",
    );
    await expect(
      operateProjectFile(
        [root],
        { action: "create", target: ref(root), name: "a", kind: "file" },
        native,
      ),
    ).rejects.toThrow();
    expect(await readFile(path.join(root.path, "a"), "utf8")).toBe("a");
  });

  it("rejects read-only writes and prevents using external paths to bypass source permissions", async () => {
    const root = await folder();
    const readonly = { ...(await folder()), access: "read-only" as const };
    await writeFile(path.join(readonly.path, "notes"), "notes");
    await expect(
      operateProjectFile(
        [root, readonly],
        { action: "create", target: ref(readonly), name: "new", kind: "file" },
        native,
      ),
    ).rejects.toThrow("read-only");
    await expect(
      operateProjectFile(
        [root, readonly],
        {
          action: "move-external",
          target: ref(root),
          paths: [path.join(readonly.path, "notes")],
        },
        native,
      ),
    ).rejects.toThrow("read-only");
    await expect(
      resolveProjectEntry([readonly], ref(readonly, "notes")),
    ).resolves.toBe(path.join(readonly.path, "notes"));
  });

  it("rejects root deletion, self moves, traversal and symlink escapes", async () => {
    const root = await folder();
    const outside = await folder();
    await mkdir(path.join(root.path, "docs"));
    await mkdir(path.join(root.path, "docs/child"));
    await symlink(outside.path, path.join(root.path, "link"));
    await expect(
      operateProjectFile(
        [root],
        { action: "trash", target: ref(root) },
        native,
      ),
    ).rejects.toThrow("project root");
    await expect(
      operateProjectFile(
        [root],
        {
          action: "move",
          target: ref(root, "docs/child"),
          sources: [ref(root, "docs")],
        },
        native,
      ),
    ).rejects.toThrow("itself");
    await expect(
      operateProjectFile(
        [root],
        {
          action: "create",
          target: ref(root),
          name: "../escape",
          kind: "file",
        },
        native,
      ),
    ).rejects.toThrow();
    await expect(resolveProjectEntry([root], ref(root, "../"))).rejects.toThrow(
      "outside",
    );
    await expect(
      resolveProjectEntry([root], ref(root, "link")),
    ).rejects.toThrow("outside");
    expect(native.trash).not.toHaveBeenCalled();
  });

  it("protects nested project roots while allowing creation alongside them", async () => {
    const root = await folder();
    await mkdir(path.join(root.path, "reference"));
    const nested = {
      ...root,
      id: crypto.randomUUID(),
      path: path.join(root.path, "reference"),
      access: "read-only" as const,
    };
    await operateProjectFile(
      [root, nested],
      { action: "create", target: ref(root), name: "sibling", kind: "file" },
      native,
    );
    await expect(
      operateProjectFile(
        [root, nested],
        { action: "rename", target: ref(root, "reference"), name: "renamed" },
        native,
      ),
    ).rejects.toThrow("project root");
  });

  it("uses the native trash, open, reveal and clipboard APIs for resolved entries", async () => {
    const root = await folder();
    const filePath = path.join(root.path, "notes");
    await writeFile(filePath, "notes");
    for (const action of ["open", "reveal", "copy-path", "trash"] as const) {
      await operateProjectFile(
        [root],
        { action, target: ref(root, "notes") },
        native,
      );
    }
    expect(native.open).toHaveBeenCalledWith(filePath);
    expect(native.reveal).toHaveBeenCalledWith(filePath);
    expect(native.copyPath).toHaveBeenCalledWith(filePath);
    expect(native.trash).toHaveBeenCalledWith(filePath);
  });
});
