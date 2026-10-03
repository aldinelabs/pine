import { describe, expect, it } from "vitest";
import { CompletionSignalTracker } from "../completionSignal";
import type { PineAgentEvent, PineAgentRunState } from "../../shared/agent";

function runState(state: PineAgentRunState, sessionId = "s1"): PineAgentEvent {
  return { type: "run-state", sessionId, state };
}

function assistantEnd(
  content: unknown[],
  sessionId = "s1",
  role = "assistant",
): PineAgentEvent {
  return {
    type: "message-end",
    sessionId,
    messageId: "m",
    message: { role, content } as never,
  };
}

describe("CompletionSignalTracker", () => {
  it("reports the final assistant text without thinking or tool calls", () => {
    const tracker = new CompletionSignalTracker();
    tracker.observe(runState("running"));
    tracker.observe(
      assistantEnd([
        { type: "text", text: "Checking files" },
        { type: "toolCall", id: "t1", name: "bash", arguments: {} },
      ]),
    );
    tracker.observe(
      assistantEnd([
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "All done." },
      ]),
    );

    expect(tracker.observe(runState("idle"))).toEqual({
      sessionId: "s1",
      text: "All done.",
    });
  });

  it("ignores user messages", () => {
    const tracker = new CompletionSignalTracker();
    tracker.observe(runState("running"));
    tracker.observe(assistantEnd([{ type: "text", text: "Reply" }]));
    tracker.observe(
      assistantEnd([{ type: "text", text: "Steer" }], "s1", "user"),
    );

    expect(tracker.observe(runState("idle"))?.text).toBe("Reply");
  });

  it("does not signal user aborts, failures, or repeated idle events", () => {
    const tracker = new CompletionSignalTracker();
    tracker.observe(runState("running"));
    tracker.observe(runState("aborting"));
    expect(tracker.observe(runState("idle"))).toBeUndefined();

    tracker.observe(runState("running"));
    expect(tracker.observe(runState("failed"))).toBeUndefined();
    expect(tracker.observe(runState("idle"))).toBeUndefined();

    tracker.observe(runState("running"));
    expect(tracker.observe(runState("idle"))).toBeDefined();
    expect(tracker.observe(runState("idle"))).toBeUndefined();
  });

  it("does not carry text over from an earlier run", () => {
    const tracker = new CompletionSignalTracker();
    tracker.observe(runState("running"));
    tracker.observe(assistantEnd([{ type: "text", text: "First" }]));
    tracker.observe(runState("idle"));

    tracker.observe(runState("running"));
    expect(tracker.observe(runState("idle"))?.text).toBe("");
  });

  it("tracks sessions independently", () => {
    const tracker = new CompletionSignalTracker();
    tracker.observe(runState("running", "a"));
    tracker.observe(runState("running", "b"));
    tracker.observe(assistantEnd([{ type: "text", text: "From A" }], "a"));

    expect(tracker.observe(runState("idle", "b"))?.text).toBe("");
    expect(tracker.observe(runState("idle", "a"))?.text).toBe("From A");
  });
});
