import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteSideChat,
  discardUnusedSideChat,
  listSideChats,
  sideChatsDirectory,
} from "../sideChats";

const anchor = {
  messageId: "m1",
  start: 0,
  end: 5,
  text: "Hello",
  quote: "Hello",
};

async function writeSideChat(
  directory: string,
  id: string,
  parentSessionId: string,
  question?: string,
): Promise<void> {
  const lines = [
    { type: "session", id, timestamp: "2026-01-01T00:00:00.000Z", cwd: "/" },
    {
      type: "message",
      id: "a",
      parentId: null,
      message: { role: "user", content: "parent question" },
    },
    {
      type: "custom",
      id: "b",
      parentId: "a",
      customType: "pine.side-chat",
      data: { parentSessionId, anchor },
    },
    ...(question
      ? [
          {
            type: "message",
            id: "c",
            parentId: "b",
            message: { role: "user", content: question },
          },
        ]
      : []),
  ];
  await writeFile(
    path.join(directory, `${id}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join("\n"),
  );
}

describe("saved side chats", () => {
  it("keeps them apart per conversation", () => {
    expect(sideChatsDirectory("/data", "abc")).toBe(
      path.join("/data", "side-chats", "abc"),
    );
    expect(() => sideChatsDirectory("/data", "../x")).toThrow();
  });

  it("lists side chats with their anchor and first question", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pine-side-chats-"));
    await writeSideChat(directory, "s1", "parent", "  What  does this mean? ");
    await writeSideChat(directory, "s2", "other", "Not mine");
    const sideChats = await listSideChats(directory, "parent");
    expect(sideChats).toHaveLength(1);
    expect(sideChats[0]).toMatchObject({
      id: "s1",
      parentSessionId: "parent",
      anchor,
      title: "What does this mean?",
    });
  });

  it("titles an edited follow-up with its edited question", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pine-side-chats-"));
    await writeSideChat(directory, "edited", "parent", "First wording");
    const file = path.join(directory, "edited.jsonl");
    const edited = [
      {
        type: "message",
        id: "d",
        parentId: "c",
        message: { role: "assistant", content: "An answer" },
      },
      {
        type: "message",
        id: "e",
        parentId: "b",
        message: { role: "user", content: "Second wording" },
      },
    ];
    await writeFile(
      file,
      `${await readFile(file, "utf8")}\n${edited.map((line) => JSON.stringify(line)).join("\n")}`,
    );
    const [sideChat] = await listSideChats(directory, "parent");
    expect(sideChat?.title).toBe("Second wording");
  });

  it("discards a side chat closed before anything was asked", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pine-side-chats-"));
    await writeSideChat(directory, "empty", "parent");
    await writeSideChat(directory, "asked", "parent", "Why?");
    expect(await discardUnusedSideChat(directory, "parent", "asked")).toBe(
      false,
    );
    expect(await discardUnusedSideChat(directory, "parent", "empty")).toBe(
      true,
    );
    expect(await deleteSideChat(directory, "parent", "asked")).toBe(true);
    expect(await listSideChats(directory, "parent")).toEqual([]);
  });
});
