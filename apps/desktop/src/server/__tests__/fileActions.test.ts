// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serverFileActions } from "../fileActions";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("serverFileActions", () => {
  it("moves trashed files into the data directory's trash", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pine-server-trash-"));
    directories.push(directory);
    const file = path.join(directory, "notes.md");
    await writeFile(file, "kept");
    const trash = path.join(directory, "trash");

    await serverFileActions(trash).trash(file);

    const [entry] = await readdir(trash);
    expect(entry).toMatch(/-notes\.md$/);
    expect(await readFile(path.join(trash, entry), "utf8")).toBe("kept");
    await expect(readFile(file)).rejects.toThrow();
  });

  it("leaves desktop-only actions to the browser", () => {
    const actions = serverFileActions("/unused");
    expect(() => actions.open("/a")).toThrow("unavailable");
    expect(() => actions.reveal("/a")).toThrow("unavailable");
    expect(() => actions.copyPath("/a")).toThrow("unavailable");
  });
});
