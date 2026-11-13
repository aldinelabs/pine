/*
 * BASELINE. The real
 * `ProjectThinkingMarker` and the real `animateScrollTop` run on a fake 60 Hz
 * clock; the panel's layout is stubbed (256 px tall, as `max-h-64`). One
 * second of fast thinking is simulated: 8 flushes 120 ms apart, each adding a
 * paragraph and followed by a resize notification.
 *
 * | id | metric                                                | before | W2-A | after | target |
 * | -- | ----------------------------------------------------- | ------ | ---- | ----- | ------ |
 * | T1 | animateScrollTop calls during the stream              | 8      | 0    | 0     | 0      |
 * | T1 | animation frames run during the stream                | 60     | 0    | 0     | 0      |
 * | T2 | scrollTop writes on the panel during the stream       | 60     | 8    | 0     | 0      |
 * | T2 | panel shows the newest paragraph                      | yes    | yes  | yes   | yes    |
 * | T3 | panel carries the scroll-timeline `scroll-fade` class | yes    | no   | no    | no     |
 * | T4 | timers / frames pending 600 ms after it collapses     | 0 / 0  | 0/0  | 0 / 0 | 0 / 0  |
 * | T5 | markdown source rendered per flush                    | all    | all  | block | block  |
 *
 * "before" is the marker before any perf change; "W2-A" followed the stream
 * in a scroll container with one native smooth `scrollTo` per resize report.
 * "after" is the live view: while thinking streams the panel shows only the
 * paragraph being written, so it renders one block and never scrolls.
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callStats,
  frameClock,
  layoutStub,
  reportMetrics,
  resizeObserverStub,
} from "@/__tests__/perf/streamHarness";
import { createAppI18n } from "@/app/i18n";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { animateScrollTop } from "@/lib/animateScroll";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectThinkingMarker from "../ProjectThinkingMarker.vue";

vi.mock("@/lib/animateScroll", async (original) => {
  const actual = await original<typeof import("@/lib/animateScroll")>();
  const { callCounter } = await import("@/__tests__/perf/streamHarness");
  return { ...actual, animateScrollTop: callCounter(actual.animateScrollTop) };
});

const FLUSHES = 8;
const FLUSH_INTERVAL_MS = 120;
const PANEL_HEIGHT = 256;
const THINKING_STARTED_AT = Date.parse("2026-09-03T00:00:00.000Z");

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function thinkingMessage(lines: number): PineTranscriptMessage {
  return {
    id: "assistant-thinking",
    createdAt: "2026-09-03T00:00:00.000Z",
    role: "assistant",
    status: "streaming",
    thinkingStatus: "streaming",
    thinkingStartedAt: THINKING_STARTED_AT,
    blocks: [
      {
        type: "thinking",
        thinking: Array.from(
          { length: lines },
          (_, line) => `Step ${line + 1}: weigh the next option.`,
        ).join("\n\n"),
      },
    ],
  };
}

/** A marker whose thinking already fills the panel. */
async function mountStreamingMarker() {
  const clock = frameClock({ now: THINKING_STARTED_AT });
  const observers = resizeObserverStub();
  const pinia = createPinia();
  setActivePinia(pinia);
  let lines = 10;
  const wrapper: VueWrapper = mount(ProjectThinkingMarker, {
    props: { message: thinkingMessage(lines) },
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  cleanups.push(
    () => clock.restore(),
    () => observers.restore(),
    () => wrapper.unmount(),
  );
  const panel = wrapper.get<HTMLElement>("[data-thinking-live]").element;
  const layout = layoutStub(panel, {
    scrollHeight: PANEL_HEIGHT,
    clientHeight: PANEL_HEIGHT,
  });
  await clock.advance(600);

  const scroll = callStats(animateScrollTop);
  scroll.reset();
  clock.resetFrames();
  layout.reset();

  /** One flush: a new paragraph, the resize report, then 120 ms. */
  async function flush(): Promise<void> {
    lines += 1;
    await wrapper.setProps({ message: thinkingMessage(lines) });
    observers.fire((target) => panel.contains(target));
    await clock.advance(FLUSH_INTERVAL_MS);
  }

  return { clock, flush, layout, panel, scroll, wrapper, lines: () => lines };
}

async function streamOneSecond() {
  const marker = await mountStreamingMarker();
  for (let index = 0; index < FLUSHES; index++) await marker.flush();
  const metrics = {
    animateScrollTopCalls: marker.scroll.calls(),
    framesRun: marker.clock.framesRun(),
    scrollTopWrites: marker.layout.scrollTopWrites(),
  };
  reportMetrics("thinking stream, 1 s", metrics);
  // The panel is open and shows the newest paragraph, not the first.
  expect(marker.wrapper.get("button").attributes("aria-expanded")).toBe("true");
  expect(marker.panel.textContent).toContain(`Step ${marker.lines()}:`);
  expect(marker.panel.textContent).not.toContain("Step 1:");
  return { marker, metrics };
}

describe("ProjectThinkingMarker streaming cost", () => {
  it("[T1] runs no scroll tween and no animation frame while thinking streams", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.animateScrollTopCalls).toBe(0);
    expect(metrics.framesRun).toBe(0);
  });

  it("[T2] never writes the panel's scroll position while thinking streams", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.scrollTopWrites).toBe(0);
  });

  it("[T3] does not put a scroll-timeline fade on the panel", async () => {
    const marker = await mountStreamingMarker();
    reportMetrics("thinking panel classes", {
      hasScrollFade: marker.panel.classList.contains("scroll-fade"),
    });
    expect(marker.panel.classList.contains("scroll-fade")).toBe(false);
  });

  it("[T4] leaves no timer or frame behind once thinking has collapsed", async () => {
    const { marker } = await streamOneSecond();
    const finished = thinkingMessage(marker.lines());
    await marker.wrapper.setProps({
      message: {
        ...finished,
        thinkingStatus: "complete",
        thinkingDurationMs: 1_600,
        blocks: [...finished.blocks, { type: "text", text: "Here it is." }],
      },
    });
    expect(marker.wrapper.get("button").attributes("aria-expanded")).toBe(
      "false",
    );
    await marker.clock.advance(600);

    reportMetrics("thinking collapsed, 600 ms later", {
      pendingTimers: marker.clock.pendingTimers(),
      pendingFrames: marker.clock.pendingFrames(),
      panelMounted:
        marker.wrapper.find("[data-thinking-content]").exists() ||
        marker.wrapper.find("[data-thinking-live]").exists(),
    });
    expect(marker.wrapper.find("[data-thinking-content]").exists()).toBe(false);
    expect(marker.wrapper.find("[data-thinking-live]").exists()).toBe(false);
    expect(marker.clock.pendingTimers()).toBe(0);
    expect(marker.clock.pendingFrames()).toBe(0);
  });

  it("[T5] renders only the paragraph being written, not the whole thinking", async () => {
    const { marker } = await streamOneSecond();
    const sources = marker.wrapper
      .findAllComponents(MarkdownContent)
      .map((component) => component.props("source") as string);
    const total = thinkingMessage(marker.lines()).blocks[0];
    reportMetrics("thinking markdown per flush", {
      renderedChars: sources.at(-1)?.length ?? 0,
      totalChars: total.type === "thinking" ? total.thinking.length : 0,
    });
    expect(sources.at(-1)).toBe(
      `Step ${marker.lines()}: weigh the next option.`,
    );
    // At most the current paragraph and the one fading out.
    expect(sources.length).toBeLessThanOrEqual(2);
  });
});
