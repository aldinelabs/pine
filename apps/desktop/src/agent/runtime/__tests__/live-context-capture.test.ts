import { describe, expect, it, vi } from "vitest";
import type {
  LiveContextCaptureOperation,
  LiveContextCaptureResult,
} from "../../../shared/liveContextAgent";
import {
  createLiveContextCaptureToolDefinition,
  LIVE_CONTEXT_CAPTURE_DESCRIPTION,
} from "../live-context-capture";

type Execute = (
  id: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ content: { text: string }[] }>;

const READY: LiveContextCaptureResult = {
  outcome: "ready",
  settings: { sources: ["mic", "system"], locale: "zh-CN", speakers: false },
};

const LISTENING: LiveContextCaptureResult = {
  outcome: "status",
  state: "listening",
  sources: ["mic", "system"],
  locale: "zh-CN",
  speakers: false,
};

function setup(
  answers: Partial<
    Record<LiveContextCaptureOperation["op"], LiveContextCaptureResult>
  >,
  decision: { kind: "allow" } | { kind: "deny"; reason?: string } = {
    kind: "allow",
  },
) {
  const call = vi.fn((operation: LiveContextCaptureOperation) => {
    const answer = answers[operation.op];
    return answer
      ? Promise.resolve(answer)
      : Promise.reject(new Error(`unexpected ${operation.op}`));
  });
  const requestApproval = vi.fn().mockResolvedValue(decision);
  const sendCommand = vi.fn();
  const tool = createLiveContextCaptureToolDefinition({
    call,
    requestApproval,
    sendCommand,
  });
  return {
    call,
    requestApproval,
    sendCommand,
    tool,
    execute: ((...args: Parameters<Execute>) =>
      (tool.execute as unknown as Execute)(...args)) as Execute,
  };
}

describe("live_context_capture", () => {
  it("is static", () => {
    expect(setup({}).tool.description).toBe(LIVE_CONTEXT_CAPTURE_DESCRIPTION);
  });

  it("asks on the approval card with the planned settings, then opens the card and starts", async () => {
    const { call, requestApproval, sendCommand, execute } = setup({
      "plan-start": READY,
      start: LISTENING,
    });
    const result = await execute("call-1", {
      action: "start",
      language: "zh-CN",
    });
    expect(call.mock.calls.map(([operation]) => operation)).toEqual([
      { op: "plan-start", locale: "zh-CN" },
      { op: "start", settings: READY.outcome === "ready" && READY.settings },
    ]);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: "call-1",
        toolName: "live_context_capture",
        liveContextCapture: {
          sources: ["mic", "system"],
          locale: "zh-CN",
          speakers: false,
        },
      }),
    );
    expect(sendCommand).toHaveBeenCalledWith("call-1", {
      kind: "open",
      panel: "live-context",
      highlight: true,
    });
    expect(result.content[0].text).toBe(
      "Live Context is listening (microphone and system audio, zh-CN, speaker labels off).",
    );
  });

  it("starts nothing when the user declines", async () => {
    const { call, sendCommand, execute } = setup(
      { "plan-start": READY, start: LISTENING },
      { kind: "deny" },
    );
    await expect(execute("call-1", { action: "start" })).rejects.toThrow(
      "The user declined to start Live Context.",
    );
    expect(call.mock.calls.map(([operation]) => operation.op)).toEqual([
      "plan-start",
    ]);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("leaves another conversation's capture alone without asking", async () => {
    const { requestApproval, sendCommand, execute } = setup({
      "plan-start": { outcome: "elsewhere" },
    });
    await expect(execute("call-1", { action: "start" })).rejects.toThrow(
      /Another conversation is capturing/,
    );
    expect(requestApproval).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("reports a capture already running here without asking again", async () => {
    const { requestApproval, execute } = setup({ "plan-start": LISTENING });
    const result = await execute("call-1", { action: "start" });
    expect(result.content[0].text).toContain("is listening");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("says when Live Context is unavailable", async () => {
    const { execute } = setup({
      "plan-start": { outcome: "unavailable", reason: "platform" },
    });
    await expect(execute("call-1", { action: "start" })).rejects.toThrow(
      "Live Context is unavailable: it needs macOS 26 or later.",
    );
  });

  it("explains a missing permission and points at the card", async () => {
    const { execute } = setup({
      "plan-start": READY,
      start: {
        outcome: "status",
        state: "idle",
        sources: ["mic", "system"],
        error: { code: "permission_denied", source: "system" },
      },
    });
    await expect(execute("call-1", { action: "start" })).rejects.toThrow(
      /macOS denied access to the system audio\. The Live Context card shows where to allow it/,
    );
  });

  it("pauses and stops without approval", async () => {
    const { requestApproval, execute } = setup({
      pause: { ...LISTENING, state: "paused" },
      stop: { outcome: "status", state: "idle", sources: [] },
    });
    expect(
      (await execute("call-1", { action: "pause" })).content[0].text,
    ).toContain("is paused");
    expect(
      (await execute("call-2", { action: "stop" })).content[0].text,
    ).toContain("is stopped");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("says when there is nothing of this conversation's to stop", async () => {
    const { execute } = setup({ stop: { outcome: "idle" } });
    await expect(execute("call-1", { action: "stop" })).rejects.toThrow(
      "Live Context isn't capturing in this conversation.",
    );
  });
});
