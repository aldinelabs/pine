import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PineMemoryRepository } from "../../memory/repository";
import {
  assistantMemoryNotice,
  createAssistantMemoryToolDefinitions,
} from "../memory";

let root: string;
let repository: PineMemoryRepository;
let enabled: boolean;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pine-assistant-memory-"));
  repository = new PineMemoryRepository({
    global: path.join(root, "global"),
    project: path.join(root, "assistant"),
  });
  enabled = true;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function tools(withMemory = true) {
  const definitions = createAssistantMemoryToolDefinitions(
    withMemory
      ? {
          repository,
          isEnabled: () => enabled,
          sessionId: () => "assistant-session",
        }
      : undefined,
  );
  const byName = (name: string) => {
    const found = definitions.find((definition) => definition.name === name);
    if (!found) throw new Error(`No ${name}`);
    return (params: Record<string, unknown>) =>
      found.execute("call", params, undefined, undefined, {} as never);
  };
  return {
    names: definitions.map((definition) => definition.name),
    read: byName("memory_read"),
    save: byName("memory_save"),
    remove: byName("memory_remove"),
  };
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

describe("the Assistant's memory", () => {
  it("always lists the same three tools", () => {
    expect(tools().names).toEqual([
      "memory_read",
      "memory_save",
      "memory_remove",
    ]);
    expect(tools(false).names).toEqual(tools().names);
  });

  it("saves aliases in its own folder and reads them back", async () => {
    const { save, read } = tools();
    await save({
      name: "project-alias-blog",
      description: "“博客” means the Garden project",
      content: "The user calls the Garden project 博客.",
      verified: true,
    });
    expect(await readdir(path.join(root, "assistant"))).toEqual([
      "project-alias-blog.md",
    ]);
    await expect(readdir(path.join(root, "global"))).rejects.toThrow();
    expect(text(await read({ name: "project-alias-blog" }))).toContain(
      'scope="assistant"',
    );
  });

  it("cannot write a global note: save and remove take no scope", async () => {
    await repository.save({
      scope: "global",
      name: "user-prefers-chinese",
      description: "Reply in Chinese",
      content: "The user wants replies in Chinese.",
      verified: true,
    });
    const { save, remove, read } = tools();
    await save({
      name: "user-prefers-chinese",
      description: "planted",
      content: "planted",
      verified: true,
      scope: "global",
    });
    // The save landed in the Assistant's own scope; the global note is untouched.
    expect(
      (await repository.read("global", "user-prefers-chinese"))?.content,
    ).toBe("The user wants replies in Chinese.");
    await remove({ name: "user-prefers-chinese" });
    expect(
      await repository.read("global", "user-prefers-chinese"),
    ).toBeDefined();
    expect(
      text(await read({ scope: "global", name: "user-prefers-chinese" })),
    ).toContain("replies in Chinese");
  });

  it("refuses every call while memory is off, or without a repository", async () => {
    enabled = false;
    await expect(tools().read({})).rejects.toThrow(/turned off/);
    await expect(tools(false).read({})).rejects.toThrow(/not available/);
  });

  it("lists its notes before the global ones in its notice", () => {
    const notice = assistantMemoryNotice([
      {
        name: "g",
        scope: "global",
        description: "global",
        verified: true,
        updatedAt: "",
      },
      {
        name: "a",
        scope: "project",
        description: "alias",
        verified: false,
        updatedAt: "",
      },
    ]);
    expect(notice.indexOf("Your notes")).toBeLessThan(
      notice.indexOf("Global notes"),
    );
    expect(notice).toContain("- a (unverified): alias");
  });
});
