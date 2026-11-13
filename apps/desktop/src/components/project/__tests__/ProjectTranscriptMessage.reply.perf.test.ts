/*
 * BASELINE. The real `ProjectTranscriptMessage` and markstream run on a fake
 * clock. A long assistant reply (headings, paragraphs, loose lists, code
 * fences, tables) streams in 300 characters per flush, flushes 100 ms apart
 * (`MESSAGE_UPDATE_BATCH_MS`): a fast model. Counts come from one run with a
 * component counter; times from a separate run without it (the counter's own
 * hooks cost more than what it counts). "7.7k" is the default 12-section
 * reply (26 flushes), "23k" the 36-section one (`PINE_PERF_SECTIONS=36`).
 *
 * | id | metric (per flush unless noted)                   | before        | after       | target       |
 * | -- | ------------------------------------------------- | ------------- | ----------- | ------------ |
 * | R1 | Markdown chars re-rendered, max (7.7k / 23k)      | 7,655 / 23,111 | 741 / 741  | tail-bounded |
 * | R2 | chars handed to markdown-it, last flush           | 7,655 / 23,111 | 474 / 322  | O(tail)      |
 * | R3 | component updates, mean (7.7k / 23k)              | 42 / 76       | 62 / 62     | -            |
 * | R4 | flush wall time, happy-dom, median of last 10     | 12.0 / 18.2 ms | 10.4 / 12.0 ms | -       |
 * | R5 | finished reply has the same text and structure    | -             | yes         | yes          |
 *
 * "before" renders each Markdown segment as one `MarkdownContent`, which
 * re-parses and re-diffs the whole segment on every flush; "after" renders
 * each completed Markdown block once and re-renders only the block being
 * written (a block completed by a flush stays streaming one more flush, so
 * its last fade plays out, then turns final: R3's extra updates). R4 also
 * prints a one-piece `MarkdownContent` beside the block view for reference.
 *
 * In Chromium (`scripts/verify-stream-perf.mjs --phase-ms=30000` with
 * system Chrome, text phase only: 30 s, ~25k chars, 100 chars per 120 ms):
 *
 * | history rows | metric (30 s)           | before   | after    |
 * | ------------ | ----------------------- | -------- | -------- |
 * | 10           | style recalc            | 2,860 ms | 539 ms   |
 * | 10           | main-thread task time   | 5,678 ms | 3,060 ms |
 * | 10           | script / layout         | 139 / 139 ms | 182 / 163 ms |
 * | 120          | style recalc            | 3,196 ms | 739 ms   |
 * | 120          | main-thread task time   | 6,835 ms | 4,852 ms |
 * | 120          | script / layout         | 131 / 221 ms | 195 / 344 ms |
 * | both         | longest frame interval  | 33.4 ms  | 16.8 ms  |
 *
 * Markdown script time is small either way; the one-piece render's cost is
 * style recalculation, which grows with the reply (15 s phase: 977 ms).
 * Frames held 60 fps in both; the 15 s runs were noisier (w=120 task time
 * 1,881 -> 2,312 ms) and the 30 s runs are the ones recorded.
 *
 * A segment with footnotes or link reference definitions renders in one
 * piece: a reference resolves only against definitions in its own render.
 *
 * Follow scroll is unchanged. `message-scroller/__tests__/followLoop.perf
 * .test.ts` measures it: per second of streaming ~135 animation frame
 * callbacks and 60 `scrollTop` writes, with 10 passes of rectangle reads on
 * message items, whatever the reply's length; in Chromium its script and
 * layout stay a few ms a second. The FLIP glide would have to move the
 * sticky tail, the anchor and spacer reads and open popovers with a
 * transform, for no measured gain.
 *
 * Wall times vary by machine; only the counts are asserted. Print the
 * metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when vitest hides
 * the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import type { Component } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  componentCounter,
  frameClock,
  markdownParses,
  reportMetrics,
} from "@/__tests__/perf/streamHarness";
import { createAppI18n } from "@/app/i18n";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectTranscriptMessage from "../ProjectTranscriptMessage.vue";

vi.mock("@/components/markdown/configureMarkdown", async (original) => {
  const actual =
    await original<typeof import("@/components/markdown/configureMarkdown")>();
  const { countMarkdownParses } =
    await import("@/__tests__/perf/streamHarness");
  return {
    ...actual,
    configurePineMarkdown: countMarkdownParses(actual.configurePineMarkdown),
  };
});

/** Chars per flush: ~3,000 chars a second, a fast model. */
const CHUNK = 300;
/** `MESSAGE_UPDATE_BATCH_MS` in `agent/runtime/event-forwarder.ts`. */
const FLUSH_INTERVAL_MS = 100;
const SECTIONS = Number(process.env.PINE_PERF_SECTIONS ?? 12);

function section(index: number): string {
  return [
    `## Step ${index}: check the next module`,
    `The module **${index}** reads its input, validates it and hands the result on. It keeps \`state-${index}\` small so a reader can follow it.`,
    `- First, read the file and note its exports.\n- Then compare it with the callers.\n  A second line continues the item.\n- Finally, write down what changes.`,
    "```ts",
    `export function step${index}(input: string): string {\n  const trimmed = input.trim();\n  return trimmed.length > 0 ? trimmed : "empty-${index}";\n}`,
    "```",
    `| Option | Cost | Notes |\n| --- | ---: | --- |\n| Keep ${index} | 1 | **stable** |\n| Replace ${index} | 2 | needs a \`migration\` |`,
    `1. Run the tests.\n\n2. Read the output.\n\n3. Decide on step ${index + 1}.`,
  ].join("\n\n");
}

const REPLY = Array.from({ length: SECTIONS }, (_, index) =>
  section(index + 1),
).join("\n\n");
const FLUSHES = Math.ceil(REPLY.length / CHUNK);

function replyMessage(
  text: string,
  status: "streaming" | "complete",
): PineTranscriptMessage {
  return {
    id: "assistant-reply",
    createdAt: "2026-09-03T00:00:00.000Z",
    role: "assistant",
    status,
    blocks: [{ type: "text", text }],
  };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function mountWith(
  component: Component,
  props: Record<string, unknown>,
  counter?: ReturnType<typeof componentCounter>,
) {
  const clock = frameClock();
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper: VueWrapper = mount(component, {
    props,
    attachTo: document.body,
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      mixins: counter ? [counter.mixin] : [],
    },
  });
  const cleanup = () => {
    wrapper.unmount();
    clock.restore();
  };
  cleanups.push(cleanup);
  return { clock, wrapper, cleanup };
}

/** Real elapsed milliseconds; the fake clock does not touch `hrtime`. */
function realNow(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 10) / 10;
}

/** Block elements and text of the rendered Markdown, without fade spans. */
function renderedShape(wrapper: VueWrapper): string {
  const tags: string[] = [];
  for (const render of wrapper.findAll('[data-slot="markdown-content"]'))
    for (const child of render.element.querySelectorAll(
      "h2, p, li, pre, table, ol, ul",
    ))
      tags.push(child.tagName);
  const text = wrapper.text().replace(/\s+/g, " ").trim();
  return `${tags.join(",")}\n${text}`;
}

function replyAt(flush: number): string {
  return REPLY.slice(0, Math.min(REPLY.length, flush * CHUNK));
}

interface CountMetrics {
  maxCharsPerFlush: number;
  parsedCharsLastFlush: number;
  replyLength: number;
  meanComponentUpdates: number;
  streamingRendersLastFlush: number;
  finishedShape: string;
  freshShape: string;
}

async function countStream(): Promise<CountMetrics> {
  const counter = componentCounter();
  const { clock, wrapper } = mountWith(
    ProjectTranscriptMessage,
    { message: replyMessage("", "streaming") },
    counter,
  );
  const parses = markdownParses();
  const renders = () => wrapper.findAllComponents(MarkdownContent);
  let lastRenders = new Map<object, [string, boolean]>();
  /** Markdown chars handed to renders whose source or `final` changed. */
  const recordChars = (): number => {
    const next = new Map<object, [string, boolean]>();
    let chars = 0;
    for (const render of renders()) {
      const source = render.props("source") as string;
      const final = render.props("final") as boolean;
      next.set(render.vm.$, [source, final]);
      const previous = lastRenders.get(render.vm.$);
      if (!previous || previous[0] !== source || previous[1] !== final)
        chars += source.length;
    }
    lastRenders = next;
    return chars;
  };

  const chars: number[] = [];
  let parsedCharsLastFlush = 0;
  counter.reset();
  for (let flush = 1; flush <= FLUSHES; flush++) {
    parses.reset();
    await wrapper.setProps({
      message: replyMessage(replyAt(flush), "streaming"),
    });
    await clock.advance(FLUSH_INTERVAL_MS);
    chars.push(recordChars());
    parsedCharsLastFlush = parses.fullCharacters();
  }
  const updates = Object.values(counter.updateTable()).reduce(
    (total, count) => total + count,
    0,
  );
  const streamingRendersLastFlush = renders().filter(
    (render) => render.props("final") === false,
  ).length;

  await wrapper.setProps({ message: replyMessage(REPLY, "complete") });
  await clock.advance(1_000);
  const finishedShape = renderedShape(wrapper);

  const fresh = mountWith(ProjectTranscriptMessage, {
    message: replyMessage(REPLY, "complete"),
  });
  await fresh.clock.advance(1_000);
  const freshShape = renderedShape(fresh.wrapper);

  const metrics: CountMetrics = {
    maxCharsPerFlush: Math.max(...chars),
    parsedCharsLastFlush,
    replyLength: REPLY.length,
    meanComponentUpdates: Math.round(updates / FLUSHES),
    streamingRendersLastFlush,
    finishedShape,
    freshShape,
  };
  reportMetrics("transcript reply stream, counts", {
    maxCharsPerFlush: metrics.maxCharsPerFlush,
    parsedCharsLastFlush: metrics.parsedCharsLastFlush,
    replyLength: metrics.replyLength,
    meanComponentUpdates: metrics.meanComponentUpdates,
    streamingRendersLastFlush: metrics.streamingRendersLastFlush,
  });
  return metrics;
}

/** Median wall time of the last 10 flushes, without any counter mounted. */
async function timeStream(onePiece: boolean): Promise<number> {
  const props = (text: string) =>
    onePiece
      ? { source: text, final: false }
      : { message: replyMessage(text, "streaming") };
  const { clock, wrapper, cleanup } = mountWith(
    onePiece ? MarkdownContent : ProjectTranscriptMessage,
    props(""),
  );
  const times: number[] = [];
  for (let flush = 1; flush <= FLUSHES; flush++) {
    const start = realNow();
    await wrapper.setProps(props(replyAt(flush)));
    await clock.advance(FLUSH_INTERVAL_MS);
    times.push(realNow() - start);
  }
  cleanup();
  return median(times.slice(-10));
}

let counted: Promise<CountMetrics> | undefined;

/** The counted stream runs once and is shared by the tests. */
function countMetrics(): Promise<CountMetrics> {
  counted ??= countStream();
  return counted;
}

describe("ProjectTranscriptMessage streaming cost", () => {
  it("[R1] re-renders only the Markdown block being written", async () => {
    const metrics = await countMetrics();
    expect(metrics.maxCharsPerFlush).toBeGreaterThan(0);
    // A flush adds ~300 chars and may complete a few blocks; never the
    // whole reply.
    expect(metrics.maxCharsPerFlush).toBeLessThan(metrics.replyLength / 4);
    // The tail, plus blocks this flush completed: they stay streaming one
    // more flush so their last fade is not cut short.
    expect(metrics.streamingRendersLastFlush).toBeLessThanOrEqual(3);
  });

  it("[R2] hands markdown-it the tail, not the whole reply", async () => {
    const metrics = await countMetrics();
    expect(metrics.parsedCharsLastFlush).toBeLessThan(metrics.replyLength / 4);
  });

  it("[R4] records a flush's wall time beside the one-piece render", async () => {
    // Warm the parser and renderer so neither run pays the first compile.
    await timeStream(true);
    const onePiece = await timeStream(true);
    const blocks = await timeStream(false);
    reportMetrics("transcript reply stream, wall time (ms)", {
      onePiece,
      blocks,
    });
    expect(blocks).toBeGreaterThan(0);
  });

  it("[R5] renders the same text and structure as one finished render", async () => {
    const metrics = await countMetrics();
    expect(metrics.finishedShape).toBe(metrics.freshShape);
  });
});
