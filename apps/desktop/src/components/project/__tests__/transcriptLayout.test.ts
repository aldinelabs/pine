import type { PineContentBlock, PineToolCall } from "@/shared/sessions";
import { describe, expect, it } from "vitest";
import {
  collapsesTranscriptGap,
  transcriptMessageRenderSignature,
  type TranscriptRenderState,
} from "../transcriptLayout";

type TranscriptMessage = Parameters<typeof collapsesTranscriptGap>[0][number];

function toolCall(id: string): PineToolCall {
  return { id, name: "bash", status: "complete" };
}

function assistant(blocks: PineContentBlock[]): TranscriptMessage {
  return { role: "assistant", blocks };
}

function user(): TranscriptMessage {
  return { role: "user", blocks: [] };
}

describe("collapsesTranscriptGap", () => {
  it("collapses a tool-call-only turn following an assistant turn", () => {
    const messages = [
      assistant([{ type: "text", text: "Working on it." }]),
      assistant([{ type: "toolCall", toolCall: toolCall("t1") }]),
    ];
    expect(collapsesTranscriptGap(messages, 1)).toBe(true);
  });

  it("keeps the gap when the turn starts with thinking or text", () => {
    const messages = [
      assistant([{ type: "text", text: "Working on it." }]),
      assistant([
        { type: "thinking", thinking: "Let me check." },
        { type: "toolCall", toolCall: toolCall("t1") },
      ]),
    ];
    expect(collapsesTranscriptGap(messages, 1)).toBe(false);
  });

  it("keeps the gap after a user message", () => {
    const messages = [
      user(),
      assistant([{ type: "toolCall", toolCall: toolCall("t1") }]),
    ];
    expect(collapsesTranscriptGap(messages, 1)).toBe(false);
  });

  it("never collapses the first message", () => {
    expect(
      collapsesTranscriptGap(
        [assistant([{ type: "toolCall", toolCall: toolCall("t1") }])],
        0,
      ),
    ).toBe(false);
  });
});

describe("transcriptMessageRenderSignature", () => {
  const idle: TranscriptRenderState = {
    expandedToolRuns: new Set(),
    reviewingToolCallIds: new Set(),
    awaitingApprovalToolCallIds: new Set(),
    isRunning: false,
    hasRewriteHandler: true,
  };
  const turn = {
    id: "m1",
    role: "assistant" as const,
    blocks: [
      { type: "text" as const, text: "Checking." },
      { type: "toolCall" as const, toolCall: toolCall("t1") },
      { type: "toolCall" as const, toolCall: toolCall("t2") },
    ],
  };

  it("ignores state that belongs to other messages", () => {
    const signature = transcriptMessageRenderSignature(turn, idle);
    expect(
      transcriptMessageRenderSignature(turn, {
        expandedToolRuns: new Set(["m2:t9"]),
        reviewingToolCallIds: new Set(["t9"]),
        awaitingApprovalToolCallIds: new Set(["t9"]),
        isRunning: true,
        hasRewriteHandler: false,
      }),
    ).toBe(signature);
  });

  it("changes when the message's own tool run expands or is reviewed", () => {
    const signature = transcriptMessageRenderSignature(turn, idle);
    for (const state of [
      { ...idle, expandedToolRuns: new Set(["m1:t1"]) },
      { ...idle, reviewingToolCallIds: new Set(["t2"]) },
      { ...idle, awaitingApprovalToolCallIds: new Set(["t1"]) },
    ]) {
      expect(transcriptMessageRenderSignature(turn, state)).not.toBe(signature);
    }
  });

  it("tracks running and rewrite availability for user messages", () => {
    const message = { id: "u1", role: "user" as const, blocks: [] };
    const signature = transcriptMessageRenderSignature(message, idle);
    expect(
      transcriptMessageRenderSignature(message, { ...idle, isRunning: true }),
    ).not.toBe(signature);
    expect(
      transcriptMessageRenderSignature(message, {
        ...idle,
        hasRewriteHandler: false,
      }),
    ).not.toBe(signature);
  });
});
