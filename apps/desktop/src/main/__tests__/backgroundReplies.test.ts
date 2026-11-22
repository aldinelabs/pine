import { describe, expect, it } from "vitest";
import { BackgroundReplies } from "../backgroundReplies";
import type { PineAgentEvent } from "../../shared/agent";

function runState(
  sessionId: string,
  state: "idle" | "running" | "aborting" | "failed",
): PineAgentEvent {
  return { type: "run-state", sessionId, state };
}

describe("BackgroundReplies", () => {
  it("tells a watched session's answer once", () => {
    const replies = new BackgroundReplies();
    replies.watch("s1");
    const done = { sessionId: "s1", text: "42" };
    expect(replies.observe(runState("s1", "idle"), done)).toEqual({
      kind: "answered",
      sessionId: "s1",
      text: "42",
    });
    expect(replies.observe(runState("s1", "idle"), done)).toBeUndefined();
  });

  it("leaves sessions nobody asked about alone", () => {
    const replies = new BackgroundReplies();
    expect(
      replies.observe(runState("s2", "idle"), { sessionId: "s2", text: "" }),
    ).toBeUndefined();
    expect(
      replies.observe(runState("s2", "failed"), undefined),
    ).toBeUndefined();
  });

  it("tells a failed run, and stays quiet for one the user stopped", () => {
    const replies = new BackgroundReplies();
    replies.watch("s1");
    expect(replies.observe(runState("s1", "failed"), undefined)).toEqual({
      kind: "failed",
      sessionId: "s1",
    });
    replies.watch("s2");
    expect(
      replies.observe(runState("s2", "aborting"), undefined),
    ).toBeUndefined();
    expect(replies.observe(runState("s2", "idle"), undefined)).toBeUndefined();
    expect(
      replies.observe(runState("s2", "idle"), { sessionId: "s2", text: "" }),
    ).toBeUndefined();
  });
});
