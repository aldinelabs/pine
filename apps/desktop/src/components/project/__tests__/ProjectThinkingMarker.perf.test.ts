/*
 * BASELINE. The real
 * `ProjectThinkingMarker` and the real `animateScrollTop` run on a fake 60 Hz
 * clock; the panel's layout is stubbed (256 px tall, as `max-h-64`). One
 * second of fast thinking is simulated: 8 flushes 120 ms apart, each adding a
 * line (44 px) and followed by a resize notification, after the opening pin
 * has settled.
 *
 * | id | metric                                                | before | after | target |
 * | -- | ----------------------------------------------------- | ------ | ----- | ------ |
 * | T1 | animateScrollTop calls during the stream              | 8      | 0     | 0      |
 * | T1 | animation frames run during the stream                | 60     | 0     | 0      |
 * | T2 | scrollTop writes on the panel during the stream       | 60     | 8     | <= 8   |
 * | T2 | panel ends at scrollHeight - clientHeight             | no     | yes   | yes    |
 * | T3 | panel carries the scroll-timeline `scroll-fade` class | yes    | no    | no     |
 * | T4 | timers / frames pending 600 ms after it collapses     | 0 / 0  | 0 / 0 | 0 / 0  |
 * | T5 | thinking Markdown re-renders during the stream        | 8      | 4     | <= 5   |
 *
 * "before" is the marker before any perf change; "after" follows with one
 * native smooth `scrollTo` per resize report (the stub applies it at once),
 * a state-driven edge fade, and streamed text reaching the panel at most
 * every 250 ms. All targets hold.
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
/** The marker's `THINKING_UPDATE_INTERVAL_MS`. */
const THINKING_UPDATE_INTERVAL_MS = 250;
const PANEL_HEIGHT = 256;
const LINE_HEIGHT = 44;
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

/** A marker whose thinking already fills the panel and follows its end. */
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
  const panel = wrapper.get<HTMLElement>("[data-thinking-content]").element;
  const layout = layoutStub(panel, {
    scrollHeight: lines * LINE_HEIGHT,
    clientHeight: PANEL_HEIGHT,
  });
  // The opening pin may glide; the stream is measured after it has settled.
  await clock.advance(600);
  expect(layout.scrollTop()).toBe(layout.maxScrollTop());

  const scroll = callStats(animateScrollTop);
  scroll.reset();
  clock.resetFrames();
  layout.reset();

  /** One flush: a new line, its layout, the resize report, then 120 ms. */
  async function flush(): Promise<void> {
    lines += 1;
    layout.set({ scrollHeight: lines * LINE_HEIGHT });
    await wrapper.setProps({ message: thinkingMessage(lines) });
    observers.fire((target) => panel.contains(target));
    await clock.advance(FLUSH_INTERVAL_MS);
    const source = renderedSource();
    if (source !== lastSource) renders += 1;
    lastSource = source;
  }

  /** The pending trailing update lands and the panel reports its size. */
  async function settle(): Promise<void> {
    await clock.advance(THINKING_UPDATE_INTERVAL_MS);
    observers.fire((target) => panel.contains(target));
    await clock.advance(FLUSH_INTERVAL_MS);
  }

  const renderedSource = () =>
    wrapper.getComponent(MarkdownContent).props("source") as string;
  let lastSource = renderedSource();
  let renders = 0;

  return {
    clock,
    flush,
    settle,
    layout,
    panel,
    scroll,
    wrapper,
    lines: () => lines,
    renders: () => renders,
  };
}

async function streamOneSecond() {
  const marker = await mountStreamingMarker();
  for (let index = 0; index < FLUSHES; index++) await marker.flush();
  const markdownRenders = marker.renders();
  await marker.settle();
  const metrics = {
    markdownRenders,
    animateScrollTopCalls: marker.scroll.calls(),
    framesRun: marker.clock.framesRun(),
    scrollTopWrites: marker.layout.scrollTopWrites(),
    endsAtBottom: marker.layout.scrollTop() === marker.layout.maxScrollTop(),
  };
  reportMetrics("thinking stream, 1 s", metrics);
  // The panel is open and shows the newest line.
  expect(marker.wrapper.get("button").attributes("aria-expanded")).toBe("true");
  expect(marker.panel.textContent).toContain(`Step ${marker.lines()}:`);
  return { marker, metrics };
}

describe("ProjectThinkingMarker streaming cost", () => {
  it("[T1] runs no scroll tween and no animation frame while thinking streams", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.animateScrollTopCalls).toBe(0);
    expect(metrics.framesRun).toBe(0);
  });

  it("[T2] writes the panel's scroll position at most once per flush and ends at the bottom", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.scrollTopWrites).toBeLessThanOrEqual(FLUSHES);
    expect(metrics.endsAtBottom).toBe(true);
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
      panelMounted: marker.wrapper.find("[data-thinking-content]").exists(),
    });
    expect(marker.wrapper.find("[data-thinking-content]").exists()).toBe(false);
    expect(marker.clock.pendingTimers()).toBe(0);
    expect(marker.clock.pendingFrames()).toBe(0);
  });

  it("[T5] re-renders the streaming Markdown at most every 250 ms", async () => {
    const { marker, metrics } = await streamOneSecond();
    // 8 flushes over 960 ms: one change per 250 ms, the last held back.
    expect(metrics.markdownRenders).toBeGreaterThanOrEqual(3);
    expect(metrics.markdownRenders).toBeLessThanOrEqual(5);
    // Nothing is lost: the held-back text lands.
    expect(marker.panel.textContent).toContain(`Step ${marker.lines()}:`);
  });
});
