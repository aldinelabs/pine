// @vitest-environment node
/*
 * BASELINE: first measured on the forwarder before any perf change; the
 * "after W3-B" column is with tool output coalescing, the truncated tail sent
 * once, no toolResult message events and argument deltas sent as `input`
 * only. Sizes are `JSON.stringify(...).length` of what `emit` received.
 *
 * | id | scenario                                    | metric                                 | before    | after W3-B | target |
 * | -- | ------------------------------------------- | -------------------------------------- | --------- | ---------- | ------ |
 * | E1 | 600 text deltas (5,400 chars) in 1 s        | message-update events                  | 9         | 9          | <= 9   |
 * | E1 |                                             | bytes emitted as message-update        | 12,354    | 12,354     | -      |
 * | E2 | 10 tool snapshots 100 ms apart, 50 KB tail  | tool-update events                     | 10        | 10         | <= 5   |
 * | E2 |                                             | tool-update events after tool-end      | 0         | 0          | 0      |
 * | E2 |                                             | bytes emitted as tool-update           | 1,041,110 | 522,580    | -      |
 * | E3 | tail repeated in details.truncation.content | tool-update payload bytes / tail bytes | 2.032     | 1.019      | <= 1.1 |
 * | E4 | one tool call with a 50 KB result           | toolResult message-start / message-end | 2         | 0          | 0      |
 * | E4 |                                             | events carrying the result             | 3         | 1          | 1      |
 * | E4 |                                             | bytes of those events                  | 156,216   | 52,002     | -      |
 * | E5 | 98,344 chars of streamed tool arguments     | tool-call-delta updates                | 13        | 8          | -      |
 * | E5 |                                             | of those, carrying `delta`             | 13        | 0          | 0      |
 * | E5 |                                             | of those, without `input`              | 5         | 0          | 0      |
 * | E5 |                                             | bytes of raw `delta` emitted           | 98,378    | 0          | 0      |
 * | E5 |                                             | bytes emitted as message-update        | 494,031   | 394,868    | -      |
 *
 * Holds: E1, E2 ordering, E3, E4, E5. Not met (`it.fails`): the E2 count. The
 * SDK already sends bash output at most every 100 ms and live output must keep
 * that refresh rate (user decision), so 10 snapshots 100 ms apart stay 10
 * updates; coalescing only saves when a tool reports faster than that.
 *
 * Print the metrics with `PINE_PERF_LOG=1`. Run from a coding agent, vitest
 * picks a reporter that hides the output of passing tests; add
 * `--reporter=default` to see it.
 */
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PineAgentEvent,
  PineAssistantMessageUpdate,
  PineJsonValue,
} from "../../../shared/agent";
import { reportMetrics } from "../../../__tests__/perf/streamHarness";
import { PineAgentEventForwarder } from "../event-forwarder";
import type { LiveAgentSession } from "../session-state";

const SESSION_ID = "session-1";
const TAIL_BYTES = 50 * 1024;
const LINE = `${"x".repeat(79)}\n`;

/** The union member whose `type` includes `Type` (several members share one shape). */
type EventOfType<Event, Type> = Event extends { type: infer Member }
  ? Type extends Member
    ? Event
    : never
  : never;
type EmittedEvent<Type extends PineAgentEvent["type"]> = EventOfType<
  PineAgentEvent,
  Type
>;

function bytes(value: unknown): number {
  const json = JSON.stringify(value) as string | undefined;
  return json?.length ?? 0;
}

function createForwarder() {
  const emitted: PineAgentEvent[] = [];
  const session = { sessionId: SESSION_ID } as unknown as AgentSession;
  const live = { session } as unknown as LiveAgentSession;
  const emitContextUsage = vi.fn();
  const forwarder = new PineAgentEventForwarder({
    emit: (event) => {
      emitted.push(event);
    },
    getLiveSession: () => live,
    getSession: () => live,
    emitSteeringQueue: vi.fn(),
    recordApprovalDecision: vi.fn(),
    generateInitialTitle: vi.fn(() => Promise.resolve()),
    getContextUsage: vi.fn(() => undefined),
    emitContextUsage,
  });

  return {
    emitted,
    emitContextUsage,
    forward: (event: unknown) => {
      forwarder.forward(session, event as AgentSessionEvent);
    },
    ofType: <Type extends PineAgentEvent["type"]>(type: Type) =>
      emitted.filter(
        (event): event is EmittedEvent<Type> => event.type === type,
      ),
  };
}

/** The live accumulator the SDK shares between the events of one message. */
function assistantPartial(content: unknown[]) {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function messageUpdate(
  partial: ReturnType<typeof assistantPartial>,
  assistantMessageEvent: Record<string, unknown>,
) {
  return {
    type: "message_update",
    message: partial,
    assistantMessageEvent: { ...assistantMessageEvent, partial },
  };
}

/** A tail of exactly `TAIL_BYTES` whose first line names the snapshot. */
function outputTail(sequence: number): string {
  const head = `snapshot ${String(sequence).padStart(4, "0")}\n`;
  const body = LINE.repeat(Math.ceil(TAIL_BYTES / LINE.length));
  return (head + body).slice(0, TAIL_BYTES);
}

/** What the SDK bash tool passes to `onUpdate` once its output is truncated. */
function bashSnapshot(tail: string) {
  const lines = tail.split("\n").length;
  return {
    content: [{ type: "text", text: tail }],
    details: {
      truncation: {
        content: tail,
        truncated: true,
        truncatedBy: "bytes",
        totalLines: lines * 4,
        totalBytes: tail.length * 4,
        outputLines: lines,
        outputBytes: tail.length,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines: 2000,
        maxBytes: TAIL_BYTES,
      },
      fullOutputPath: "/tmp/pi-bash-0123456789abcdef.log",
    },
  };
}

function toolEvent(
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end",
  toolCallId: string,
  rest: Record<string, unknown>,
) {
  return { type, toolCallId, toolName: "bash", ...rest };
}

function payloadText(payload: PineJsonValue | undefined): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (Array.isArray(payload)) return undefined;
  const content = payload.content;
  if (!Array.isArray(content)) return undefined;
  const block = content[0];
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return undefined;
  }
  return typeof block.text === "string" ? block.text : undefined;
}

function messageRole(message: PineJsonValue): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  if (Array.isArray(message)) return undefined;
  return typeof message.role === "string" ? message.role : undefined;
}

describe("agent event forwarder streaming cost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("[E1] batches 600 text deltas within one second into at most 9 updates", () => {
    const { forward, ofType } = createForwarder();
    const block = { type: "text", text: "" };
    const partial = assistantPartial([block]);
    const delta = "streamed ";
    let sent = "";

    forward({ type: "message_start", message: partial });
    forward(messageUpdate(partial, { type: "text_start", contentIndex: 0 }));
    for (let tick = 0; tick < 100; tick += 1) {
      for (let index = 0; index < 6; index += 1) {
        block.text += delta;
        sent += delta;
        forward(
          messageUpdate(partial, {
            type: "text_delta",
            contentIndex: 0,
            delta,
          }),
        );
      }
      vi.advanceTimersByTime(10);
    }
    forward(
      messageUpdate(partial, {
        type: "text_end",
        contentIndex: 0,
        content: sent,
      }),
    );
    forward({ type: "message_end", message: partial });
    vi.advanceTimersByTime(1_000);

    const updates = ofType("message-update");
    const received = updates
      .flatMap((event) => event.updates)
      .map((update) => (update.type === "text-delta" ? update.delta : ""))
      .join("");
    reportMetrics("E1", {
      deltasIn: 600,
      messageUpdateEvents: updates.length,
      bytesIn: sent.length,
      bytesOut: updates.reduce((total, event) => total + bytes(event), 0),
    });

    expect(received).toBe(sent);
    expect(updates.length).toBeLessThanOrEqual(9);
  });

  /** Ten 50 KB snapshots 100 ms apart, the bash tool's own update throttle. */
  function streamTenSnapshots() {
    const { emitted, forward, ofType } = createForwarder();
    const toolCallId = "call-1";
    const tails = Array.from({ length: 10 }, (_, index) => outputTail(index));

    forward(
      toolEvent("tool_execution_start", toolCallId, {
        args: { command: "bun run build" },
      }),
    );
    tails.forEach((tail, index) => {
      if (index > 0) vi.advanceTimersByTime(100);
      forward(
        toolEvent("tool_execution_update", toolCallId, {
          args: { command: "bun run build" },
          partialResult: bashSnapshot(tail),
        }),
      );
    });
    // The command exits right after its last snapshot, before any timer.
    forward(
      toolEvent("tool_execution_end", toolCallId, {
        result: bashSnapshot(tails.at(-1) ?? ""),
        isError: false,
      }),
    );
    vi.advanceTimersByTime(1_000);

    const updates = ofType("tool-update");
    const endIndex = emitted.findIndex((event) => event.type === "tool-end");
    const afterEnd = emitted
      .slice(endIndex + 1)
      .filter((event) => event.type === "tool-update");
    const beforeEnd = emitted[endIndex - 1];
    reportMetrics("E2", {
      snapshotsIn: tails.length,
      toolUpdateEvents: updates.length,
      toolUpdatesAfterEnd: afterEnd.length,
      toolUpdateBytes: updates.reduce(
        (total, event) => total + bytes(event),
        0,
      ),
    });
    return { tails, updates, endIndex, afterEnd, beforeEnd };
  }

  it("[E2] sends the latest tool output before tool-end and nothing after", () => {
    const { tails, updates, endIndex, afterEnd, beforeEnd } =
      streamTenSnapshots();

    expect(endIndex).toBeGreaterThan(0);
    expect(afterEnd).toHaveLength(0);
    expect(beforeEnd?.type).toBe("tool-update");
    expect(
      beforeEnd?.type === "tool-update"
        ? payloadText(beforeEnd.payload)
        : undefined,
    ).toBe(tails.at(-1));
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  // Not reachable without a visible change: the SDK already sends bash output
  // at most every 100 ms and live output must keep refreshing that often, so
  // ten snapshots 100 ms apart stay ten updates. At most 5 would need a
  // 200 ms+ cadence, which the user ruled out.
  it.fails(
    "[E2] coalesces ten 50 KB tool output snapshots into at most 5 updates",
    () => {
      const { updates } = streamTenSnapshots();
      expect(updates.length).toBeLessThanOrEqual(5);
    },
  );

  it("[E3] sends a truncated tool output tail once per update", () => {
    const { forward, ofType } = createForwarder();
    const tail = outputTail(0);

    forward(
      toolEvent("tool_execution_start", "call-1", {
        args: { command: "bun run build" },
      }),
    );
    forward(
      toolEvent("tool_execution_update", "call-1", {
        args: { command: "bun run build" },
        partialResult: bashSnapshot(tail),
      }),
    );
    vi.advanceTimersByTime(1_000);

    const updates = ofType("tool-update");
    const largest = Math.max(
      0,
      ...updates.map((event) => bytes(event.payload)),
    );
    reportMetrics("E3", {
      tailBytes: tail.length,
      payloadBytes: largest,
      ratio: Number((largest / tail.length).toFixed(3)),
    });

    expect(updates.length).toBeGreaterThanOrEqual(1);
    for (const update of updates) {
      expect(payloadText(update.payload)).toBe(tail);
    }
    expect(largest).toBeLessThanOrEqual(tail.length * 1.1);
  });

  it("[E4] does not forward message events for a toolResult message", () => {
    const { emitted, emitContextUsage, forward, ofType } = createForwarder();
    const toolCallId = "call-1";
    const assistant = assistantPartial([
      {
        type: "toolCall",
        id: toolCallId,
        name: "bash",
        arguments: { command: "cat big.log" },
      },
    ]);
    const result = {
      content: [{ type: "text", text: outputTail(0) }],
      details: {},
    };
    // Shape of pi-agent-core's `createToolResultMessage`.
    const toolResult = {
      role: "toolResult",
      toolCallId,
      toolName: "bash",
      content: result.content,
      details: result.details,
      isError: false,
      durationMs: 12,
      timestamp: 2,
    };

    forward({ type: "message_start", message: assistant });
    forward({ type: "message_end", message: assistant });
    forward(
      toolEvent("tool_execution_start", toolCallId, {
        args: { command: "cat big.log" },
      }),
    );
    forward(
      toolEvent("tool_execution_end", toolCallId, { result, isError: false }),
    );
    forward({ type: "message_start", message: toolResult });
    forward({ type: "message_end", message: toolResult });
    vi.advanceTimersByTime(1_000);

    const messageEvents = [
      ...ofType("message-start"),
      ...ofType("message-end"),
    ];
    const forToolResult = messageEvents.filter(
      (event) => messageRole(event.message) === "toolResult",
    );
    const forAssistant = messageEvents.filter(
      (event) => messageRole(event.message) === "assistant",
    );
    const resultCopies = emitted.filter((event) =>
      JSON.stringify(event).includes("snapshot 0000"),
    );
    reportMetrics("E4", {
      toolResultMessageEvents: forToolResult.length,
      resultCopies: resultCopies.length,
      resultBytes: resultCopies.reduce(
        (total, event) => total + bytes(event),
        0,
      ),
    });

    expect(ofType("tool-end")).toHaveLength(1);
    expect(forAssistant.map((event) => event.type)).toEqual([
      "message-start",
      "message-end",
    ]);
    // Context usage is still reported after the tool result lands.
    expect(emitContextUsage).toHaveBeenCalledTimes(2);
    expect(forToolResult).toHaveLength(0);
    expect(resultCopies).toHaveLength(1);
  });

  it("[E5] emits tool argument deltas as parsed input only", () => {
    const { forward, ofType } = createForwarder();
    const toolCall = {
      type: "toolCall",
      id: "call-1",
      name: "write",
      arguments: {} as Record<string, unknown>,
    };
    const partial = assistantPartial([toolCall]);
    const content = "y".repeat(96 * 1024);
    const json = JSON.stringify({ path: "/project/big.txt", content });
    const chunkSize = 2 * 1024;

    forward({ type: "message_start", message: partial });
    forward(
      messageUpdate(partial, { type: "toolcall_start", contentIndex: 0 }),
    );
    // 4 chunks per transport batch, so the 64 KB preview cap is crossed
    // part-way through the stream.
    for (let offset = 0, chunk = 0; offset < json.length; chunk += 1) {
      const delta = json.slice(offset, offset + chunkSize);
      offset += delta.length;
      forward(
        messageUpdate(partial, {
          type: "toolcall_delta",
          contentIndex: 0,
          delta,
        }),
      );
      if (chunk % 4 === 3) vi.advanceTimersByTime(120);
    }
    toolCall.arguments = { path: "/project/big.txt", content };
    forward(
      messageUpdate(partial, {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall,
      }),
    );
    forward({ type: "message_end", message: partial });
    vi.advanceTimersByTime(1_000);

    const events = ofType("message-update");
    const deltas = events
      .flatMap((event) => event.updates)
      .filter(
        (
          update,
        ): update is Extract<
          PineAssistantMessageUpdate,
          { type: "tool-call-delta" }
        > => update.type === "tool-call-delta",
      );
    const withDelta = deltas.filter((update) => "delta" in update);
    const withoutInput = deltas.filter((update) => update.input === undefined);
    reportMetrics("E5", {
      argumentBytesIn: json.length,
      messageUpdateEvents: events.length,
      toolCallDeltaUpdates: deltas.length,
      withDelta: withDelta.length,
      withoutInput: withoutInput.length,
      rawDeltaBytes: withDelta.reduce(
        (total, update) => total + bytes(update.delta),
        0,
      ),
      bytesOut: events.reduce((total, event) => total + bytes(event), 0),
    });

    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(events.every((event) => event.updates.length > 0)).toBe(true);
    expect(withDelta).toHaveLength(0);
    expect(withoutInput).toHaveLength(0);
  });
});
