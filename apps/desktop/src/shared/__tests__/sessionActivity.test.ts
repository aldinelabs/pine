import { describe, expect, it } from "vitest";
import { sessionActivityAt } from "../sessionActivity";

describe("sessionActivityAt", () => {
  it("dates a session by its latest user or assistant message", () => {
    const created = Date.parse("2026-11-03T08:00:00.000Z");
    const entries = [
      {
        type: "message",
        timestamp: "2026-11-03T08:01:00.000Z",
        message: {
          role: "user",
          timestamp: Date.parse("2026-11-03T08:01:00.000Z"),
        },
      },
      {
        type: "message",
        timestamp: "2026-11-03T08:02:00.000Z",
        message: { role: "assistant" },
      },
      // A tool result and a bookkeeping entry after it don't move the session.
      {
        type: "message",
        timestamp: "2026-11-03T08:03:00.000Z",
        message: { role: "toolResult" },
      },
      { type: "custom", timestamp: "2026-11-03T08:04:00.000Z" },
    ];
    expect(sessionActivityAt(entries, created, 0)).toBe(
      "2026-11-03T08:02:00.000Z",
    );
  });

  it("falls back to when the session was created", () => {
    expect(
      sessionActivityAt([], Date.parse("2026-11-03T08:00:00.000Z"), 0),
    ).toBe("2026-11-03T08:00:00.000Z");
  });
});
