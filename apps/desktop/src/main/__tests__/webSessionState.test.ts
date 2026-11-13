import { describe, expect, it } from "vitest";
import { WebSessionState } from "../webSessionState";

describe("WebSessionState", () => {
  it("does not replay one-off notifications and keeps only the latest compaction state", () => {
    const state = new WebSessionState();
    const sessionId = "session";
    state.observe("project", {
      type: "session-teleported",
      sessionId,
      fromProjectId: "a",
      toProjectId: "b",
    } as never);
    state.observe("project", {
      type: "session-reset",
      sessionId,
      projectId: "project",
    });
    state.observe("project", { type: "compaction-start", sessionId } as never);
    state.observe("project", { type: "compaction-end", sessionId } as never);
    const [snapshot] = state.snapshots(() => "project");
    expect(snapshot.events.map((event) => event.type)).toEqual([
      "compaction-end",
    ]);
  });

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

  it("folds a late reviewer explanation into the replayed approval card", () => {
    const state = new WebSessionState();
    const sessionId = "session";
    const explanation = { summary: "Deletes logs.", risks: ["Permanent."] };
    state.observe("project", {
      type: "approval-request",
      sessionId,
      requestId: "approval",
      toolCallId: "tool",
      toolName: "bash",
      trigger: "pre-execution",
      explanationPending: true,
    });
    state.observe("project", {
      type: "approval-explanation",
      sessionId,
      requestId: "approval",
      toolCallId: "tool",
      explanation,
    });
    state.observe("project", {
      type: "approval-explanation",
      sessionId,
      requestId: "gone",
      toolCallId: "other",
      explanation,
    });
    const events = state.snapshots(() => "project")[0].events;
    expect(events.filter((event) => event.type === "approval-request")).toEqual(
      [
        expect.objectContaining({
          requestId: "approval",
          explanationPending: false,
          explanation,
        }),
      ],
    );
    expect(events.some((event) => event.type === "approval-explanation")).toBe(
      false,
    );
  });

  it("leaves finished messages and tools to history and keeps when a running tool started", () => {
    const state = new WebSessionState();
    const sessionId = "session";
    const message = { role: "assistant", content: [] };
    state.observe("project", {
      type: "message-start",
      sessionId,
      messageId: "done",
      message,
    });
    state.observe("project", {
      type: "message-end",
      sessionId,
      messageId: "done",
      message,
    });
    for (const toolCallId of ["finished", "running"])
      state.observe("project", {
        type: "tool-start",
        sessionId,
        toolCallId,
        toolName: "bash",
      });
    state.observe("project", {
      type: "tool-end",
      sessionId,
      toolCallId: "finished",
      toolName: "bash",
    });
    const [first] = state.snapshots(() => "project");
    expect(first.events).toEqual([
      expect.objectContaining({
        type: "tool-start",
        toolCallId: "running",
        startedAt: expect.any(String),
      }),
    ]);
    const startedAt = (first.events[0] as { startedAt: string }).startedAt;
    state.observe("project", {
      type: "tool-update",
      sessionId,
      toolCallId: "running",
      toolName: "bash",
      payload: "partial",
    });
    expect(state.snapshots(() => "project")[0].events).toEqual([
      expect.objectContaining({ type: "tool-update", startedAt }),
    ]);
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
