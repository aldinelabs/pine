// @vitest-environment node
import type {
  AgentSession,
  AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PineAgentEvent } from "../../../shared/agent";
import { PineAgentEventForwarder } from "../event-forwarder";
import type { LiveAgentSession } from "../session-state";

const SESSION_ID = "session-1";

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
    forwarder,
    forward: (event: unknown) => {
      forwarder.forward(session, event as AgentSessionEvent);
    },
    /** Emitted event types, with the output text of each tool update. */
    trace: () =>
      emitted.map((event) =>
        event.type === "tool-update" ? `update:${outputOf(event)}` : event.type,
      ),
  };
}

function outputOf(event: PineAgentEvent): string | undefined {
  if (event.type !== "tool-update") return undefined;
  const payload = event.payload as { content?: { text?: string }[] } | null;
  return payload?.content?.[0]?.text;
}

function update(text: string, toolCallId = "call-1") {
  return {
    type: "tool_execution_update",
    toolCallId,
    toolName: "bash",
    args: { command: "build" },
    partialResult: { content: [{ type: "text", text }] },
  };
}

function end(text: string, toolCallId = "call-1") {
  return {
    type: "tool_execution_end",
    toolCallId,
    toolName: "bash",
    result: { content: [{ type: "text", text }] },
    isError: false,
  };
}

describe("PineAgentEventForwarder tool output", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first update at once and the newest of a burst 100 ms later", () => {
    const { forward, trace } = createForwarder();

    forward(update("a"));
    expect(trace()).toEqual(["update:a"]);

    vi.advanceTimersByTime(20);
    forward(update("ab"));
    vi.advanceTimersByTime(20);
    forward(update("abc"));
    expect(trace()).toEqual(["update:a"]);

    vi.advanceTimersByTime(59);
    expect(trace()).toEqual(["update:a"]);
    vi.advanceTimersByTime(1);
    expect(trace()).toEqual(["update:a", "update:abc"]);

    // Updates spaced by the interval are not held back.
    vi.advanceTimersByTime(100);
    forward(update("abcd"));
    expect(trace()).toEqual(["update:a", "update:abc", "update:abcd"]);
  });

  it("flushes a pending update before tool-end and sends nothing after", () => {
    const { forward, trace } = createForwarder();

    forward(update("a"));
    vi.advanceTimersByTime(10);
    forward(update("ab"));
    forward(end("ab done"));
    vi.advanceTimersByTime(1_000);

    expect(trace()).toEqual(["update:a", "update:ab", "tool-end"]);
  });

  it("flushes a pending update before any later event of the session", () => {
    const { forward, trace } = createForwarder();

    forward(update("a"));
    vi.advanceTimersByTime(10);
    forward(update("ab"));
    forward({ type: "auto_retry_end", success: false, attempt: 2 });
    vi.advanceTimersByTime(1_000);

    expect(trace()).toEqual(["update:a", "update:ab", "session-error"]);
  });

  it("coalesces each tool call on its own", () => {
    const { forward, trace } = createForwarder();

    forward(update("a", "call-1"));
    forward(update("x", "call-2"));
    vi.advanceTimersByTime(10);
    forward(update("ab", "call-1"));
    forward(end("x done", "call-2"));
    vi.advanceTimersByTime(1_000);

    expect(trace()).toEqual([
      "update:a",
      "update:x",
      // tool-end flushes every pending update of the session first.
      "update:ab",
      "tool-end",
    ]);
  });

  it("skips a snapshot identical to the last one sent", () => {
    const { forward, trace } = createForwarder();

    forward(update("a"));
    vi.advanceTimersByTime(100);
    forward(update("a"));
    vi.advanceTimersByTime(100);
    forward(update("ab"));

    expect(trace()).toEqual(["update:a", "update:ab"]);
  });

  it("drops pending output when the session is cleared", () => {
    const { forward, forwarder, trace } = createForwarder();

    forward(update("a"));
    vi.advanceTimersByTime(10);
    forward(update("ab"));
    forwarder.clearSession(SESSION_ID);
    vi.advanceTimersByTime(1_000);

    expect(trace()).toEqual(["update:a"]);
  });

  it("flushes pending output on dispose and stops its timer", () => {
    const { forward, forwarder, trace } = createForwarder();

    forward(update("a"));
    vi.advanceTimersByTime(10);
    forward(update("ab"));
    forwarder.dispose();
    expect(trace()).toEqual(["update:a", "update:ab"]);

    vi.advanceTimersByTime(1_000);
    expect(trace()).toEqual(["update:a", "update:ab"]);
  });

  it("does not repeat a truncated tail in the update details", () => {
    const { forward, emitted } = createForwarder();

    forward({
      ...update("tail"),
      partialResult: {
        content: [{ type: "text", text: "tail" }],
        details: {
          truncation: { content: "tail", truncated: true, totalLines: 9 },
          fullOutputPath: "/tmp/out.log",
        },
      },
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        type: "tool-update",
        payload: {
          content: [{ type: "text", text: "tail" }],
          details: {
            truncation: { truncated: true, totalLines: 9 },
            fullOutputPath: "/tmp/out.log",
          },
        },
      }),
    ]);
  });

  it("keeps the truncated tail in the final tool result", () => {
    const { forward, emitted } = createForwarder();
    const result = {
      content: [{ type: "text", text: "tail" }],
      details: { truncation: { content: "tail", truncated: true } },
    };

    forward({ ...end("tail"), result });

    expect(emitted).toEqual([
      expect.objectContaining({ type: "tool-end", payload: result }),
    ]);
  });
});

describe("PineAgentEventForwarder tool result messages", () => {
  it("does not send message events for a tool result but still tracks it", () => {
    const { forward, forwarder, emitted, emitContextUsage } = createForwarder();
    const toolResult = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp: 2,
    };

    forward({ type: "message_start", message: toolResult });
    forward({ type: "message_end", message: toolResult });

    expect(emitted).toEqual([]);
    expect(emitContextUsage).toHaveBeenCalledTimes(1);
    // The runtime can still map an id back to the message.
    const ids = [
      ...((
        forwarder as unknown as {
          streamedMessages: Map<string, Map<string, unknown>>;
        }
      ).streamedMessages
        .get(SESSION_ID)
        ?.keys() ?? []),
    ];
    expect(ids).toHaveLength(1);
    expect(forwarder.streamedMessage(SESSION_ID, ids[0] ?? "")).toBe(
      toolResult,
    );
  });

  it("still sends message events for user and assistant messages", () => {
    const { forward, emitted } = createForwarder();
    const user = { role: "user", content: "hi", timestamp: 1 };

    forward({ type: "message_start", message: user });
    forward({ type: "message_end", message: user });

    expect(emitted.map((event) => event.type)).toEqual([
      "message-start",
      "message-end",
    ]);
  });
});

describe("PineAgentEventForwarder session summaries", () => {
  function createSummaryForwarder() {
    const emitted: PineAgentEvent[] = [];
    const entries: { type: string; message?: unknown; timestamp: string }[] =
      [];
    const session = {
      sessionId: SESSION_ID,
      sessionName: undefined as string | undefined,
      model: undefined,
      sessionManager: {
        getHeader: () => ({ timestamp: "2026-01-01T00:00:00.000Z" }),
        getEntries: () => entries,
      },
    };
    const live = { session } as unknown as LiveAgentSession;
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
      emitContextUsage: vi.fn(),
    });
    const forward = (type: string) => {
      forwarder.forward(
        session as unknown as AgentSession,
        { type } as unknown as AgentSessionEvent,
      );
    };
    const summaries = () =>
      emitted.flatMap((event) =>
        event.type === "session-updated" ? [event.summary] : [],
      );
    return { entries, forward, forwarder, session, summaries };
  }

  it("sends the first summary and skips equal ones", () => {
    const { entries, forward, summaries } = createSummaryForwarder();
    entries.push({ type: "custom", timestamp: "2026-01-01T00:00:01.000Z" });
    forward("entry_appended");
    entries.push({ type: "custom", timestamp: "2026-01-01T00:00:02.000Z" });
    forward("entry_appended");
    forward("session_info_changed");

    expect(summaries()).toHaveLength(1);
    expect(summaries()[0]).toMatchObject({ id: SESSION_ID, messageCount: 0 });
  });

  it("sends a summary whose content changed", () => {
    const { entries, forward, session, summaries } = createSummaryForwarder();
    forward("entry_appended");
    entries.push({
      type: "message",
      message: { role: "user", content: "hi", timestamp: Date.UTC(2026, 0, 2) },
      timestamp: "2026-01-02T00:00:00.000Z",
    });
    forward("entry_appended");
    session.sessionName = "Renamed";
    forward("session_info_changed");

    expect(summaries()).toEqual([
      expect.objectContaining({ messageCount: 0 }),
      expect.objectContaining({
        messageCount: 1,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
      expect.objectContaining({ messageCount: 1, name: "Renamed" }),
    ]);
  });

  it("always sends the summary when the run settles", () => {
    const { forward, summaries } = createSummaryForwarder();
    forward("entry_appended");
    forward("agent_settled");

    expect(summaries()).toHaveLength(2);
    expect(summaries()[1]).toEqual(summaries()[0]);
  });

  it("sends the first summary again after the session is cleared", () => {
    const { forward, forwarder, summaries } = createSummaryForwarder();
    forward("entry_appended");
    forwarder.clearSession(SESSION_ID);
    forward("entry_appended");

    expect(summaries()).toHaveLength(2);
  });
});
