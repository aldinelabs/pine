/*
 * BASELINE: measured on the store before any perf change. Every event goes
 * through the listener the store registers with `window.pine.onSessionEvent`.
 * N = messages already loaded, K = 40 flushes (20 thinking, then 20 text).
 *
 * | id | scenario                                   | metric                              | measured        | target |
 * | -- | ------------------------------------------ | ----------------------------------- | --------------- | ------ |
 * | S1 | K flushes into N = 130 and N = 2,050       | history reads per flush             | 0 / 0           | 0      |
 * | S1 | the message-start before them              | history reads (once per message)    | 0 / 0 (was 130 / 2,050) | -      |
 * | S2 | tool-call-delta without `input`            | `messages` array replaced           | no (was yes)    | no     |
 * | S3 | K flushes                                  | `structureVersion` exists           | yes (was no)    | yes    |
 * | S3 |                                            | `userMessages` exists               | yes (was no)    | yes    |
 * | S3 |                                            | `indexOfMessage` exists             | yes (was no)    | yes    |
 * | S4 | the same `session-updated` twice           | project session list replaced       | no (was yes)    | no     |
 * | S4 |                                            | all-projects session list replaced  | no (was yes)    | no     |
 *
 * All targets hold since the store keeps a structure signal and skips no-op
 * updates (W3-A); the "was" values are the measurements before that change.
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  historyReads,
  installSessionEvents,
  reportMetrics,
  resetHistoryReads,
  seedHistory,
  streamEvents,
} from "@/__tests__/perf/streamHarness";
import type { PineSessionSummary } from "@/shared/sessions";
import { useSessionStore, type PineTranscriptMessage } from "../session";

const PROJECT_ID = "project-perf";
const SESSION_ID = "session-perf";
const MESSAGE_ID = "live-assistant";
const FLUSHES = 40;
const HISTORY_SIZES = [130, 2_050] as const;

/** What W3-A adds to the per-session state. */
interface StructureSignals {
  structureVersion: number;
  userMessages: readonly PineTranscriptMessage[];
  indexOfMessage: (id: string) => number;
}

const summary: PineSessionSummary = {
  id: SESSION_ID,
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
  messageCount: 2,
  name: "Perf session",
};

function setup() {
  setActivePinia(createPinia());
  const events = installSessionEvents({
    searchSessions: () => Promise.resolve({ sessions: [summary] }),
    listAllRecentSessions: () =>
      Promise.resolve({
        sessions: [{ ...summary, projectId: PROJECT_ID }],
      }),
  });
  const store = useSessionStore();
  store.connectAgentEvents();
  const stream = streamEvents({ sessionId: SESSION_ID, messageId: MESSAGE_ID });
  return { events, store, stream };
}

/** Load N history messages, then start a turn the way the agent reports it. */
function startTurn(history: number) {
  const context = setup();
  const state = context.store.stateFor(SESSION_ID);
  state.messages = seedHistory(history);
  context.events.emit(context.stream.running());
  for (const event of context.stream.userMessage("live-user", "Go on."))
    context.events.emit(event);
  resetHistoryReads();
  context.events.emit(context.stream.messageStart());
  const startReads = historyReads();
  resetHistoryReads();
  return { ...context, state, startReads };
}

/** K flushes: thinking first, then the reply text in the next block. */
function streamFlushes(context: ReturnType<typeof setup>): void {
  for (let flush = 0; flush < FLUSHES; flush++) {
    context.events.emit(
      flush < FLUSHES / 2
        ? context.stream.thinkingDelta(`Thought ${flush}. `, 0)
        : context.stream.textDelta(`Sentence ${flush}. `, 1),
    );
  }
}

describe("session store streaming cost", () => {
  beforeEach(() => resetHistoryReads());

  it("[S1] reads no history message while a reply streams, at any length", () => {
    const perFlush: number[] = [];
    const atStart: number[] = [];
    for (const history of HISTORY_SIZES) {
      const context = startTurn(history);
      streamFlushes(context);
      perFlush.push(historyReads() / FLUSHES);
      atStart.push(context.startReads);

      // The stream really went through the store.
      expect(context.events.subscriptionCount()).toBe(1);
      expect(context.state.messages).toHaveLength(history + 2);
      const live = context.state.messages.at(-1);
      expect(live?.id).toBe(MESSAGE_ID);
      expect(live?.blocks.map((block) => block.type)).toEqual([
        "thinking",
        "text",
      ]);
    }
    reportMetrics("S1 store history reads", {
      readsPerFlushShort: perFlush[0],
      readsPerFlushLong: perFlush[1],
      readsAtMessageStartShort: atStart[0],
      readsAtMessageStartLong: atStart[1],
    });
    expect(perFlush).toEqual([0, 0]);
  });

  it("[S2] keeps the messages array for a tool-call delta that carries no input", () => {
    const context = startTurn(HISTORY_SIZES[0]);
    context.events.emit(context.stream.toolCallStart("call-1", "write", 0));
    const before = context.state.messages;
    const liveBefore = before.at(-1);

    context.events.emit(context.stream.toolCallDelta('{"path":"/tmp/a', 0));

    reportMetrics("S2 input-less tool-call delta", {
      arrayReplaced: context.state.messages !== before,
      messageReplaced: context.state.messages.at(-1) !== liveBefore,
    });
    expect(context.state.messages).toBe(before);
    expect(context.state.messages.at(-1)).toBe(liveBefore);
  });

  it("[S3] exposes a structure version, the user turns and an index lookup that streaming leaves alone", () => {
    const context = startTurn(HISTORY_SIZES[0]);
    const signals = context.state as unknown as StructureSignals;
    reportMetrics("S3 structure signals", {
      hasStructureVersion: typeof signals.structureVersion === "number",
      hasUserMessages: Array.isArray(signals.userMessages),
      hasIndexOfMessage: typeof signals.indexOfMessage === "function",
    });
    expect(typeof signals.structureVersion).toBe("number");
    expect(Array.isArray(signals.userMessages)).toBe(true);
    expect(typeof signals.indexOfMessage).toBe("function");

    const version = signals.structureVersion;
    const userMessages = signals.userMessages;
    expect(userMessages.at(-1)?.id).toBe("live-user");

    streamFlushes(context);
    context.events.emit(
      context.stream.messageEnd([
        { type: "thinking", thinking: "Done thinking." },
        { type: "text", text: "Done." },
      ]),
    );
    // In-place updates of an existing message are not a structure change.
    expect(signals.structureVersion).toBe(version);
    expect(signals.userMessages).toBe(userMessages);
    expect(signals.indexOfMessage(MESSAGE_ID)).toBe(HISTORY_SIZES[0] + 1);
    expect(signals.indexOfMessage("not-a-message")).toBe(-1);
    expect(historyReads()).toBe(0);

    // An appended message is.
    const next = streamEvents({ sessionId: SESSION_ID, messageId: "live-2" });
    context.events.emit(next.messageStart());
    expect(signals.structureVersion).toBeGreaterThan(version);
    expect(signals.indexOfMessage("live-2")).toBe(HISTORY_SIZES[0] + 2);
    // Still no new user turn.
    expect(signals.userMessages).toBe(userMessages);
  });

  it("[S4] leaves the session lists alone when the same summary arrives again", async () => {
    const context = setup();
    await context.store.loadRecent(PROJECT_ID);
    await context.store.loadAllRecent();
    const updated: PineSessionSummary = {
      ...summary,
      updatedAt: "2026-09-03T00:05:00.000Z",
      messageCount: 4,
    };
    const event = {
      type: "session-updated",
      sessionId: SESSION_ID,
      summary: updated,
    } as const;

    context.events.emit(event);
    const recent = context.store.recentSessionsFor(PROJECT_ID);
    const allRecent = context.store.allRecentSessions;
    // The first one is news and reaches both lists.
    expect(recent[0]).toMatchObject({ id: SESSION_ID, messageCount: 4 });
    expect(allRecent[0]).toMatchObject({ id: SESSION_ID, messageCount: 4 });

    context.events.emit({ ...event, summary: { ...updated } });

    reportMetrics("S4 repeated session-updated", {
      projectListReplaced:
        context.store.recentSessionsFor(PROJECT_ID) !== recent,
      allProjectsListReplaced: context.store.allRecentSessions !== allRecent,
    });
    expect(context.store.recentSessionsFor(PROJECT_ID)).toBe(recent);
    expect(context.store.allRecentSessions).toBe(allRecent);
  });
});
