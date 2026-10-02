import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { rewriteTargetEntryId } from "../session-state";

function messageEntry(
  id: string,
  role: "assistant" | "user",
  parentId: string | null,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-10-02T00:00:00.000Z",
    message: { role, content: id, timestamp: 0 },
  } as unknown as SessionEntry;
}

const branch = [
  messageEntry("u1", "user", null),
  messageEntry("a1", "assistant", "u1"),
  messageEntry("u2", "user", "a1"),
  messageEntry("a2", "assistant", "u2"),
];

describe("rewriteTargetEntryId", () => {
  it("uses the entry id when history supplied it", () => {
    expect(
      rewriteTargetEntryId(branch, { messageId: "u1", userMessagesAfter: 0 }),
    ).toBe("u1");
  });

  it("falls back to the user message position from the branch end", () => {
    expect(
      rewriteTargetEntryId(branch, {
        messageId: "live-renderer-id",
        userMessagesAfter: 1,
      }),
    ).toBe("u1");
    expect(
      rewriteTargetEntryId(branch, {
        messageId: "live-renderer-id",
        userMessagesAfter: 0,
      }),
    ).toBe("u2");
  });

  it("rejects a position outside the active branch", () => {
    expect(() =>
      rewriteTargetEntryId(branch, {
        messageId: "missing",
        userMessagesAfter: 2,
      }),
    ).toThrow();
  });
});
