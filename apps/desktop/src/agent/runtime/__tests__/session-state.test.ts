import type {
  AgentSession,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PINE_LIVE_CONTEXT_ENTRY } from "../../../shared/sessions";
import {
  rewriteTargetEntryId,
  sessionSummary,
  toolNamesForCompactionRoute,
  toolNamesForInterimAnswers,
  toolNamesForMemory,
  toolNamesForSubSession,
} from "../session-state";

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

describe("toolNamesForCompactionRoute", () => {
  const tools = ["read", "recall", "bash"];

  it("only exposes recall on the semantic route", () => {
    expect(toolNamesForCompactionRoute(tools, "semantic")).toEqual(tools);
    expect(toolNamesForCompactionRoute(tools, "model")).toEqual([
      "read",
      "bash",
    ]);
  });
});

describe("toolNamesForSubSession", () => {
  const tools = ["read", "report_progress", "bash"];

  // The parent reads only a sub-session's final reply, so an interim answer
  // would move findings out of the one message that reaches it.
  it("keeps interim answers out of sub-sessions", () => {
    expect(toolNamesForSubSession(tools, false)).toEqual(tools);
    expect(toolNamesForSubSession(tools, true)).toEqual(["read", "bash"]);
  });
});

describe("toolNamesForInterimAnswers", () => {
  const tools = ["read", "report_progress", "bash"];

  it("drops only the interim answer tool when the switch is off", () => {
    expect(toolNamesForInterimAnswers(tools, true)).toEqual(tools);
    expect(toolNamesForInterimAnswers(tools, false)).toEqual(["read", "bash"]);
  });
});

describe("toolNamesForMemory", () => {
  const tools = ["read", "memory_read", "memory_save", "memory_remove", "bash"];

  it("drops the memory tools when the switch is off", () => {
    expect(toolNamesForMemory(tools, true)).toEqual(tools);
    expect(toolNamesForMemory(tools, false)).toEqual(["read", "bash"]);
  });
});

describe("sessionSummary", () => {
  function sessionWith(entries: unknown[]): AgentSession {
    return {
      sessionId: "s1",
      sessionManager: {
        getHeader: () => ({ timestamp: "2026-11-19T00:00:00.000Z" }),
        getEntries: () => entries,
        getBranch: () => entries,
      },
    } as unknown as AgentSession;
  }

  it("marks a session started for Live Context", () => {
    const entry = {
      type: "custom",
      customType: PINE_LIVE_CONTEXT_ENTRY,
      id: "c1",
      parentId: null,
      timestamp: "2026-11-19T00:00:00.000Z",
    };
    expect(sessionSummary(sessionWith([entry])).liveContext).toBe(true);
    expect(sessionSummary(sessionWith([])).liveContext).toBeUndefined();
  });
});
