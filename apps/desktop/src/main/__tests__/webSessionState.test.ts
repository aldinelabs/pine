import { describe, expect, it } from "vitest";
import { WebSessionState } from "../webSessionState";

describe("WebSessionState", () => {
  it("compacts streaming deltas into a repeatable snapshot and keeps pending approvals", () => {
    const state = new WebSessionState();
    const sessionId = "session";
    state.observe("project", {
      type: "run-state",
      sessionId,
      state: "running",
    });
    state.observe("project", {
      type: "message-start",
      sessionId,
      messageId: "message",
      message: { role: "assistant", content: [] },
    });
    state.observe("project", {
      type: "message-update",
      sessionId,
      messageId: "message",
      updates: [{ type: "text-start", contentIndex: 0, text: "Hello" }],
    });
    for (let index = 0; index < 10; index++)
      state.observe("project", {
        type: "message-update",
        sessionId,
        messageId: "message",
        updates: [{ type: "text-delta", contentIndex: 0, delta: "!" }],
      });
    state.observe("project", {
      type: "approval-request",
      sessionId,
      requestId: "approval",
      toolCallId: "tool",
      toolName: "bash",
      trigger: "pre-execution",
    });
    const snapshots = state.snapshots(() => "project");
    const update = snapshots[0].events.find(
      (event) => event.type === "message-update",
    );
    expect(update).toMatchObject({
      updates: [{ type: "text-start", text: "Hello!!!!!!!!!!" }],
    });
    expect(
      snapshots[0].events.filter((event) => event.type === "approval-request"),
    ).toHaveLength(1);
    expect(state.snapshots(() => "project")).toEqual(snapshots);
    state.observe("project", {
      type: "approval-decided",
      sessionId,
      requestId: "approval",
      toolCallId: "tool",
      verdict: "approved",
      decidedBy: "user",
    });
    expect(
      state
        .snapshots(() => "project")[0]
        .events.some((event) => event.type === "approval-request"),
    ).toBe(false);
  });

  it("drops stale approval cards at run completion and forgets disposed sessions", () => {
    const state = new WebSessionState();
    state.observe("project", {
      type: "questionnaire-request",
      sessionId: "session",
      requestId: "question",
      toolCallId: "tool",
      questionnaire: { questions: [] },
    });
    state.observe("project", {
      type: "run-state",
      sessionId: "session",
      state: "idle",
    });
    expect(state.snapshots(() => "project")[0].events).toEqual([
      { type: "run-state", sessionId: "session", state: "idle" },
    ]);
    expect(state.snapshots(() => undefined)).toEqual([]);
    expect(state.snapshots(() => "project")).toEqual([]);
  });
});
