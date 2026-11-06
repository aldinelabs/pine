import { expect, it } from "vitest";
import type { PineAssistantMessageUpdate } from "@/shared/agent";
import {
  transcriptMessageFromEvent,
  type PineTranscriptMessage,
} from "../session";

function update(
  updates: PineAssistantMessageUpdate[],
  previous: PineTranscriptMessage | undefined,
  now: number,
) {
  return transcriptMessageFromEvent(
    {
      type: "message-update",
      sessionId: "session",
      messageId: "message",
      updates,
    },
    previous,
    now,
  )!;
}

it("resumes thinking after an earlier block has completed", () => {
  const first = update(
    [{ type: "thinking-start", contentIndex: 0, thinking: "First" }],
    undefined,
    0,
  );
  const ended = update(
    [{ type: "thinking-end", contentIndex: 0, thinking: "First" }],
    first,
    1_000,
  );
  const next = update(
    [{ type: "thinking-start", contentIndex: 1, thinking: "Second" }],
    ended,
    2_000,
  );
  expect(ended.thinkingStatus).toBe("complete");
  expect(ended.thinkingDurationMs).toBe(1_000);
  expect(next.thinkingStatus).toBe("streaming");
  expect(next.thinkingDurationMs).toBeUndefined();
  expect(next.thinkingBlocks).toEqual({
    0: { status: "complete", startedAt: 0, durationMs: 1_000 },
    1: { status: "streaming", startedAt: 2_000 },
  });
  // The displayed elapsed total carries the first second, not the idle gap.
  expect(next.thinkingStartedAt).toBe(1_000);
});

it("processes end and start in their batch order, not as one completed message", () => {
  const first = update(
    [{ type: "thinking-start", contentIndex: 0, thinking: "First" }],
    undefined,
    1_000,
  );
  const next = update(
    [
      { type: "thinking-end", contentIndex: 0, thinking: "First" },
      { type: "thinking-start", contentIndex: 1, thinking: "Second" },
      { type: "thinking-delta", contentIndex: 1, delta: " summary" },
    ],
    first,
    2_000,
  );
  expect(next.thinkingStatus).toBe("streaming");
  expect(next.blocks[1]).toEqual({
    type: "thinking",
    thinking: "Second summary",
  });
});

it("does not finish an overlapping block when a different block ends", () => {
  const first = update(
    [
      { type: "thinking-start", contentIndex: 0, thinking: "First" },
      { type: "thinking-start", contentIndex: 1, thinking: "Second" },
    ],
    undefined,
    1_000,
  );
  const next = update(
    [{ type: "thinking-end", contentIndex: 0, thinking: "First" }],
    first,
    2_000,
  );
  expect(next.thinkingStatus).toBe("streaming");
  expect(next.thinkingBlocks?.[1].status).toBe("streaming");
});

it("sums completed block durations without counting gaps", () => {
  let message = update(
    [{ type: "thinking-start", contentIndex: 0, thinking: "First" }],
    undefined,
    1_000,
  );
  message = update(
    [{ type: "thinking-end", contentIndex: 0, thinking: "First" }],
    message,
    2_000,
  );
  message = update(
    [{ type: "thinking-start", contentIndex: 1, thinking: "Second" }],
    message,
    5_000,
  );
  message = update(
    [{ type: "thinking-end", contentIndex: 1, thinking: "Second" }],
    message,
    7_000,
  );
  expect(message.thinkingStatus).toBe("complete");
  expect(message.thinkingDurationMs).toBe(3_000);
});

it("finalizes unfinished thinking on message end without changing earlier durations", () => {
  let message = update(
    [{ type: "thinking-start", contentIndex: 0, thinking: "First" }],
    undefined,
    1_000,
  );
  message = update(
    [
      { type: "thinking-end", contentIndex: 0, thinking: "First" },
      { type: "thinking-start", contentIndex: 1, thinking: "Second" },
    ],
    message,
    2_000,
  );
  const final = transcriptMessageFromEvent(
    {
      type: "message-end",
      sessionId: "session",
      messageId: "message",
      message: {
        role: "assistant",
        timestamp: 1_000,
        content: [
          { type: "thinking", thinking: "First" },
          { type: "thinking", thinking: "Second" },
        ],
      },
    },
    message,
    4_000,
  )!;
  expect(final.thinkingStatus).toBe("complete");
  expect(final.thinkingDurationMs).toBe(3_000);
  expect(final.thinkingBlocks?.[0].durationMs).toBe(1_000);
  expect(final.thinkingBlocks?.[1].durationMs).toBe(2_000);
});

it("keeps timing stable while later response text streams", () => {
  let message = update(
    [{ type: "thinking-start", contentIndex: 0, thinking: "First" }],
    undefined,
    1_000,
  );
  message = update(
    [{ type: "thinking-end", contentIndex: 0, thinking: "First" }],
    message,
    2_000,
  );
  message = update(
    [{ type: "text-start", contentIndex: 1, text: "Response" }],
    message,
    8_000,
  );
  expect(message.thinkingStatus).toBe("complete");
  expect(message.thinkingDurationMs).toBe(1_000);
});
