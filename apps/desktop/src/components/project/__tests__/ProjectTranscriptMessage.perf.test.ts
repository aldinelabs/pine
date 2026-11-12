/*
 * BASELINE: measured on the row before any perf change. The real
 * `ProjectTranscriptMessage` renders with its real children. The message is
 * built by the session store from stream events: a finished thinking block,
 * a tool call, text, a second tool call, text, and a last text block that
 * then receives K = 40 flushes. Each flush hands the row the store's new
 * message object, which reuses the block objects that did not change.
 *
 * | id | metric (per flush unless noted)                        | before | now    | target |
 * | -- | ------------------------------------------------------ | ------ | ------ | ------ |
 * | M1 | updates of the finished ProjectThinkingMarker          | 1      | 0      | 0      |
 * | M2 | splitTranscriptText calls                              | 3      | 1      | <= 1   |
 * | M2 | characters handed to splitTranscriptText, last flush   | 913    | 832    | -      |
 * | M3 | updates of the two ProjectToolCallMarker rows          | 2      | 0      | 0      |
 * | M4 | earlier text blocks rendered as final while streaming  | 0 of 2 | 2 of 2 | 2 of 2 |
 * | -  | MarkdownContent updates                                | 1      | 1      | -      |
 * | -  | component updates of any kind                          | 24     | 21     | -      |
 *
 * Holds now: M1, M2, M3, M4 (stable items for settled blocks).
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import {
  callStats,
  componentCounter,
  installSessionEvents,
  reportMetrics,
  streamEvents,
} from "@/__tests__/perf/streamHarness";
import { createAppI18n } from "@/app/i18n";
import { splitTranscriptText } from "@/components/intelligent-ui/segments";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import type { PineSessionEvent } from "@/shared/agent";
import { useSessionStore } from "@/stores/session";
import ProjectTranscriptMessage from "../ProjectTranscriptMessage.vue";

vi.mock("@/components/intelligent-ui/segments", async (original) => {
  const actual =
    await original<typeof import("@/components/intelligent-ui/segments")>();
  const { callCounter } = await import("@/__tests__/perf/streamHarness");
  return {
    ...actual,
    splitTranscriptText: callCounter(actual.splitTranscriptText),
  };
});

const SESSION_ID = "session-perf";
const MESSAGE_ID = "live-assistant";
const FLUSHES = 40;
const LAST_TEXT_INDEX = 5;

/** A tool call that streamed its arguments, ran and returned. */
function toolCallEvents(
  stream: ReturnType<typeof streamEvents>,
  contentIndex: number,
  id: string,
  path: string,
): PineSessionEvent[] {
  const tool = { sessionId: SESSION_ID, toolCallId: id, toolName: "read" };
  return [
    stream.update(
      { type: "tool-call-start", contentIndex, id, name: "read" },
      {
        type: "tool-call-end",
        contentIndex,
        id,
        name: "read",
        input: { path },
      },
    ),
    { type: "tool-start", ...tool, payload: { path } },
    {
      type: "tool-end",
      ...tool,
      payload: { content: [{ type: "text", text: `contents of ${path}` }] },
    },
  ];
}

function textEvents(
  stream: ReturnType<typeof streamEvents>,
  contentIndex: number,
  text: string,
): PineSessionEvent {
  return stream.update(
    { type: "text-start", contentIndex, text: "" },
    { type: "text-delta", contentIndex, delta: text },
    { type: "text-end", contentIndex, text },
  );
}

interface FlushMetrics {
  thinkingMarkerUpdates: number;
  toolMarkerUpdates: number;
  splitCallsPerFlush: number;
  splitCharactersLastFlush: number;
  earlierTextBlocks: number;
  earlierTextBlocksFinal: number;
  markdownUpdatesPerFlush: number;
  componentUpdatesPerFlush: number;
}

async function measureFlushes(): Promise<FlushMetrics> {
  const pinia = createPinia();
  setActivePinia(pinia);
  const events = installSessionEvents();
  const store = useSessionStore(pinia);
  store.connectAgentEvents();
  const state = store.stateFor(SESSION_ID);
  const stream = streamEvents({ sessionId: SESSION_ID, messageId: MESSAGE_ID });
  const thinking = "Check both files before answering.\n\n- a.ts\n- b.ts";
  for (const event of [
    stream.running(),
    stream.messageStart(),
    stream.update(
      { type: "thinking-start", contentIndex: 0, thinking: "" },
      { type: "thinking-delta", contentIndex: 0, delta: thinking },
      { type: "thinking-end", contentIndex: 0, thinking },
    ),
    ...toolCallEvents(stream, 1, "call-a", "/tmp/a.ts"),
    textEvents(stream, 2, "The first file defines **the parser**."),
    ...toolCallEvents(stream, 3, "call-b", "/tmp/b.ts"),
    textEvents(stream, 4, "The second file calls it:\n\n- once per flush"),
    stream.update({
      type: "text-start",
      contentIndex: LAST_TEXT_INDEX,
      text: "So",
    }),
  ])
    events.emit(event);
  const live = () => {
    const message = state.messages.at(-1);
    if (!message) throw new Error("The store built no message.");
    return message;
  };
  expect(live().blocks.map((block) => block.type)).toEqual([
    "thinking",
    "toolCall",
    "text",
    "toolCall",
    "text",
    "text",
  ]);
  expect(live().status).toBe("streaming");
  expect(live().thinkingStatus).toBe("complete");

  const counter = componentCounter();
  const wrapper = mount(ProjectTranscriptMessage, {
    props: { message: live() },
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      mixins: [counter.mixin],
    },
  });
  await flushPromises();
  expect(counter.mountedCount("ProjectThinkingMarker")).toBe(1);
  expect(counter.mountedCount("ProjectToolCallMarker")).toBe(2);

  const split = callStats(splitTranscriptText);
  counter.reset();
  split.reset();
  let splitCharactersLastFlush = 0;
  for (let flush = 0; flush < FLUSHES; flush++) {
    const untouched = live().blocks.slice(0, LAST_TEXT_INDEX);
    const sizeBefore = split.size();
    events.emit(
      stream.textDelta(` sentence ${flush} follows.`, LAST_TEXT_INDEX),
    );
    // The store keeps every block it did not touch.
    expect(live().blocks.slice(0, LAST_TEXT_INDEX)).toEqual(untouched);
    live()
      .blocks.slice(0, LAST_TEXT_INDEX)
      .forEach((block, index) => {
        expect(block).toBe(untouched[index]);
      });
    await wrapper.setProps({ message: live() });
    await flushPromises();
    splitCharactersLastFlush = split.size() - sizeBefore;
  }

  const body = wrapper
    .findAllComponents(MarkdownContent)
    .filter((markdown) => !markdown.props("compact"));
  const earlier = body.slice(0, -1);
  const updates = counter.updateTable();
  const metrics: FlushMetrics = {
    thinkingMarkerUpdates: counter.updates("ProjectThinkingMarker") / FLUSHES,
    toolMarkerUpdates: counter.updates("ProjectToolCallMarker") / FLUSHES,
    splitCallsPerFlush: split.calls() / FLUSHES,
    splitCharactersLastFlush,
    earlierTextBlocks: earlier.length,
    earlierTextBlocksFinal: earlier.filter(
      (markdown) => markdown.props("final") === true,
    ).length,
    markdownUpdatesPerFlush: counter.updates("MarkdownContent") / FLUSHES,
    componentUpdatesPerFlush:
      Object.values(updates).reduce((total, count) => total + count, 0) /
      FLUSHES,
  };
  // The flushes reached the screen.
  expect(body).toHaveLength(3);
  expect(wrapper.text()).toContain(`sentence ${FLUSHES - 1} follows.`);
  wrapper.unmount();
  reportMetrics("row flushes", { ...metrics });
  reportMetrics("row component updates", updates);
  return metrics;
}

let measured: Promise<FlushMetrics> | undefined;

/** The flushes run once and are shared by the tests. */
function flushMetrics(): Promise<FlushMetrics> {
  measured ??= measureFlushes();
  return measured;
}

describe("ProjectTranscriptMessage streaming cost", () => {
  it("[M1] leaves the finished thinking marker alone", async () => {
    const metrics = await flushMetrics();
    expect(metrics.thinkingMarkerUpdates).toBe(0);
  });

  it("[M2] splits at most one text block per flush", async () => {
    const metrics = await flushMetrics();
    expect(metrics.splitCallsPerFlush).toBeLessThanOrEqual(1);
  });

  it("[M3] leaves finished tool call markers alone", async () => {
    const metrics = await flushMetrics();
    expect(metrics.toolMarkerUpdates).toBe(0);
  });

  it("[M4] renders text blocks before the streaming one as final", async () => {
    const metrics = await flushMetrics();
    expect(metrics.earlierTextBlocks).toBe(2);
    expect(metrics.earlierTextBlocksFinal).toBe(2);
  });
});
