import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  forkEntries,
  isSideChatReadOnlyTool,
  PINE_SIDE_CHAT_ENTRY,
  resolveAnchorMessage,
  sideChatEntry,
  sideChatMessages,
  writeForkFile,
} from "../sideChat";

function parentSession(): SessionManager {
  const manager = SessionManager.inMemory("/project");
  manager.appendMessage({
    role: "user",
    content: "hello",
    timestamp: 1,
  } as never);
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "hi there" }],
    timestamp: 2,
  } as never);
  return manager;
}

describe("side chats", () => {
  it("only lets read-only tools run", () => {
    expect(isSideChatReadOnlyTool("read")).toBe(true);
    expect(isSideChatReadOnlyTool("web_search")).toBe(true);
    expect(isSideChatReadOnlyTool("ui_report_progress")).toBe(true);
    for (const name of ["bash", "write", "edit", "privileged_bash", "todo"])
      expect(isSideChatReadOnlyTool(name)).toBe(false);
  });

  it("forks the parent's branch with its entries unchanged", () => {
    const parent = parentSession();
    const fork = forkEntries(parent, "/project");
    expect(fork.header.id).not.toBe(parent.getSessionId());
    expect(fork.entries).toEqual(parent.getBranch());
    const side = SessionManager.inMemory("/project", undefined, [
      fork.header,
      ...fork.entries,
    ]);
    side.appendCustomEntry(PINE_SIDE_CHAT_ENTRY, { parentSessionId: "p" });
    side.appendMessage({
      role: "user",
      content: "why?",
      timestamp: 3,
    } as never);
    expect(side.buildSessionContext().messages.slice(0, 2)).toEqual(
      parent.buildSessionContext().messages,
    );
    expect(sideChatEntry(side.getEntries())?.data).toEqual({
      parentSessionId: "p",
    });
    expect(
      sideChatMessages(side.getBranch()).map(({ message }) => message),
    ).toEqual([{ role: "user", content: "why?", timestamp: 3 }]);
  });

  it("writes a saved fork that reopens with the same entries", () => {
    const parent = parentSession();
    const directory = mkdtempSync(path.join(tmpdir(), "pine-side-chat-"));
    const file = writeForkFile(directory, forkEntries(parent, "/project"));
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(3);
    const reopened = SessionManager.open(file, directory, "/project");
    expect(reopened.getBranch()).toEqual(parent.getBranch());
  });

  it("points an anchor on a streamed message at its entry", () => {
    const parent = parentSession();
    const branch = parent.getBranch();
    const assistant = branch[1];
    if (assistant.type !== "message") throw new Error("expected a message");
    const anchor = { messageId: "streamed", start: 0, end: 2, text: "hi" };
    expect(
      resolveAnchorMessage(anchor, branch, (id) =>
        id === "streamed" ? assistant.message : undefined,
      ),
    ).toEqual({ ...anchor, messageId: assistant.id });
    expect(() =>
      resolveAnchorMessage(anchor, branch, () => undefined),
    ).toThrow();
    const saved = { ...anchor, messageId: assistant.id };
    expect(resolveAnchorMessage(saved, branch, () => undefined)).toBe(saved);
  });
});
