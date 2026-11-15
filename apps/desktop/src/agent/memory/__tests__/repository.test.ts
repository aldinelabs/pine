import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PineMemoryRepository } from "../repository";

describe("PineMemoryRepository", () => {
  let root: string;
  let repository: PineMemoryRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "pine-memory-"));
    repository = new PineMemoryRepository({
      global: path.join(root, "global"),
      project: path.join(root, "project"),
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists nothing before any note is saved", async () => {
    expect(await repository.list()).toEqual([]);
  });

  it("saves a note as one file and reads it back", async () => {
    const saved = await repository.save({
      scope: "project",
      name: "release-flow",
      description: "  Releases go out\n on Thursdays ",
      content: "Confirmed by the user.\n",
      verified: true,
      sessionId: "session-1",
    });
    expect(saved.description).toBe("Releases go out on Thursdays");

    expect(await readdir(path.join(root, "project"))).toEqual([
      "release-flow.md",
    ]);
    expect(await repository.read("project", "release-flow")).toEqual({
      scope: "project",
      name: "release-flow",
      description: "Releases go out on Thursdays",
      content: "Confirmed by the user.",
      verified: true,
      sessionId: "session-1",
      updatedAt: saved.updatedAt,
    });
    expect(await repository.read("global", "release-flow")).toBeUndefined();
  });

  it("keeps a description that YAML would otherwise reinterpret", async () => {
    await repository.save({
      scope: "global",
      name: "quoting",
      description: 'yes: "no" # not a comment',
      content: "---\nbody with a rule line\n---",
      verified: false,
    });
    const note = await repository.read("global", "quoting");
    expect(note?.description).toBe('yes: "no" # not a comment');
    expect(note?.content).toBe("---\nbody with a rule line\n---");
    expect(note?.verified).toBe(false);
    expect(note?.sessionId).toBeUndefined();
  });

  it("replaces a note saved under the same name and scope", async () => {
    const input = {
      scope: "project" as const,
      name: "port",
      description: "Dev server port",
      verified: false,
    };
    await repository.save({ ...input, content: "5173" });
    await repository.save({ ...input, content: "5174", verified: true });
    const note = await repository.read("project", "port");
    expect(note?.content).toBe("5174");
    expect(note?.verified).toBe(true);
    expect(await readdir(path.join(root, "project"))).toEqual(["port.md"]);
  });

  it("lists project notes before global ones, each sorted by name", async () => {
    const note = { description: "d", content: "c", verified: true };
    await repository.save({ ...note, scope: "global", name: "b-global" });
    await repository.save({ ...note, scope: "project", name: "z-project" });
    await repository.save({ ...note, scope: "project", name: "a-project" });
    expect(
      (await repository.list()).map((memory) => [memory.scope, memory.name]),
    ).toEqual([
      ["project", "a-project"],
      ["project", "z-project"],
      ["global", "b-global"],
    ]);
  });

  it("skips files that are not readable notes", async () => {
    await repository.save({
      scope: "project",
      name: "good",
      description: "d",
      content: "c",
      verified: true,
    });
    const directory = path.join(root, "project");
    await writeFile(path.join(directory, "no-frontmatter.md"), "plain text");
    await writeFile(path.join(directory, "Bad Name.md"), "---\n---\n");
    await writeFile(path.join(directory, "notes.txt"), "ignored");
    expect((await repository.list()).map((memory) => memory.name)).toEqual([
      "good",
    ]);
  });

  it("rejects names that could leave the memory directory", async () => {
    await expect(
      repository.save({
        scope: "project",
        name: "../escape",
        description: "d",
        content: "c",
        verified: true,
      }),
    ).rejects.toThrow(/memory name/u);
    await expect(repository.read("project", "a/b")).rejects.toThrow();
  });

  it("rejects empty and oversized fields", async () => {
    const note = {
      scope: "project" as const,
      name: "n",
      description: "d",
      content: "c",
      verified: true,
    };
    await expect(
      repository.save({ ...note, description: " \n " }),
    ).rejects.toThrow(/description/u);
    await expect(repository.save({ ...note, content: "  " })).rejects.toThrow(
      /content/u,
    );
    await expect(
      repository.save({ ...note, description: "x".repeat(201) }),
    ).rejects.toThrow(/200/u);
  });

  it("removes a note and reports whether one was there", async () => {
    await repository.save({
      scope: "global",
      name: "gone",
      description: "d",
      content: "c",
      verified: true,
    });
    expect(await repository.remove("global", "gone")).toBe(true);
    expect(await repository.remove("global", "gone")).toBe(false);
    expect(await repository.list()).toEqual([]);
  });

  it("leaves no temporary file behind", async () => {
    await repository.save({
      scope: "global",
      name: "tidy",
      description: "d",
      content: "c",
      verified: true,
    });
    expect(await readdir(path.join(root, "global"))).toEqual(["tidy.md"]);
    expect(
      await readFile(path.join(root, "global", "tidy.md"), "utf8"),
    ).toMatch(/^---\nname: tidy\n/u);
  });

  it("has no project scope without a project", async () => {
    const globalOnly = new PineMemoryRepository({
      global: path.join(root, "global"),
    });
    expect(await globalOnly.list()).toEqual([]);
    await expect(globalOnly.read("project", "n")).rejects.toThrow(/project/u);
  });
});
