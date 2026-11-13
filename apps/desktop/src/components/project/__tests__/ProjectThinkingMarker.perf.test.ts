/*
 * BASELINE. The real
 * `ProjectThinkingMarker` runs on a fake 60 Hz clock with `animateScrollTop`
 * counted and `Element.prototype.animate` replaced by a fake that follows the
 * clock; the panel's layout is stubbed (256 px tall, as `max-h-64`, each
 * rendered line 44 px). One second of fast thinking is simulated: 8 flushes
 * 120 ms apart, each adding a line, after which the panel lays out what it
 * renders and reports its size, after the opening pin has settled.
 *
 * | id | metric                                                | before | after | target          |
 * | -- | ----------------------------------------------------- | ------ | ----- | --------------- |
 * | T1 | animateScrollTop calls during the stream              | 8      | 0     | 0               |
 * | T1 | animation frames run (opening pin and stream)         | 60     | 0     | 0               |
 * | T2 | scrollTop writes on the panel (8 panel updates)       | 60     | 8     | <= updates      |
 * | T2 | panel ends at the bottom                              | no     | yes   | yes             |
 * | T3 | panel carries the scroll-timeline `scroll-fade` class | yes    | no    | no              |
 * | T4 | timers / frames / glides left 600 ms after collapsing | 0/0/-  | 0/0/0 | 0 / 0 / 0       |
 * | T5 | panel updates (thinking Markdown changes)             | 8      | 8     | 6..8            |
 * | T6 | Element.animate calls (8 panel updates)               | -      | 8     | <= updates      |
 * | T7 | Markdown chars re-rendered per update (max of 583)    | 583    | 93    | tail-bounded    |
 * | T8 | getComputedStyle / getBoundingClientRect calls        | 0 / 0  | 0 / 0 | 0 / 0           |
 *
 * "before" is the marker before any perf change (a rAF tween per update and
 * the whole thinking text re-rendered per update); "after" follows each
 * update with one scroll write plus one transform glide on the body (FLIP,
 * run by the compositor), renders each completed Markdown block once and
 * re-renders only the block being written, and lets streamed text reach the
 * panel at most every 100 ms. All targets hold.
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  callStats,
  frameClock,
  layoutReadSpy,
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
const THINKING_UPDATE_INTERVAL_MS = 100;
const PANEL_HEIGHT = 256;
const LINE_HEIGHT = 44;
const THINKING_STARTED_AT = Date.parse("2026-09-03T00:00:00.000Z");

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function thinkingLines(lines: number): string {
  return Array.from(
    { length: lines },
    (_, line) => `Step ${line + 1}: weigh the next option.`,
  ).join("\n\n");
}

function thinkingMessage(lines: number): PineTranscriptMessage {
  return {
    id: "assistant-thinking",
    createdAt: "2026-09-03T00:00:00.000Z",
    role: "assistant",
    status: "streaming",
    thinkingStatus: "streaming",
    thinkingStartedAt: THINKING_STARTED_AT,
    blocks: [{ type: "thinking", thinking: thinkingLines(lines) }],
  };
}

interface FakeGlide {
  element: Element;
  keyframes: Keyframe[];
  readonly currentTime: number;
  readonly playState: AnimationPlayState;
  cancelled: boolean;
  cancel(): void;
  addEventListener(): void;
}

/**
 * `Element.prototype.animate` as a fake whose clock is the fake one, so the
 * marker reads glide progress the way it would from a real animation.
 */
function animateStub() {
  const descriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "animate",
  );
  const glides: FakeGlide[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    writable: true,
    value(
      this: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions,
    ): FakeGlide {
      const start = performance.now();
      const duration = Number(options.duration);
      const glide: FakeGlide = {
        element: this,
        keyframes,
        cancelled: false,
        get currentTime() {
          return Math.min(duration, performance.now() - start);
        },
        get playState() {
          if (glide.cancelled) return "idle";
          return performance.now() - start >= duration ? "finished" : "running";
        },
        cancel() {
          glide.cancelled = true;
        },
        addEventListener() {},
      };
      glides.push(glide);
      return glide;
    },
  });
  return {
    glides,
    restore(): void {
      if (descriptor)
        Object.defineProperty(Element.prototype, "animate", descriptor);
      else delete (Element.prototype as { animate?: unknown }).animate;
    },
  };
}

/** A marker whose thinking already fills the panel and follows its end. */
async function mountStreamingMarker() {
  const clock = frameClock({ now: THINKING_STARTED_AT });
  const observers = resizeObserverStub();
  const animations = animateStub();
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
    () => animations.restore(),
    () => wrapper.unmount(),
  );
  const panel = wrapper.get<HTMLElement>("[data-thinking-content]").element;
  const body = panel.firstElementChild as HTMLElement;

  const renders = () => wrapper.findAllComponents(MarkdownContent);
  const renderedText = () =>
    renders()
      .map((render) => render.props("source") as string)
      .join("\n\n");
  /** Lines the panel renders right now; layout follows them. */
  const renderedLines = () => renderedText().split("Step ").length - 1;

  const layout = layoutStub(panel, {
    scrollHeight: renderedLines() * LINE_HEIGHT,
    clientHeight: PANEL_HEIGHT,
  });
  let bodyHeight = renderedLines() * LINE_HEIGHT;
  Object.defineProperty(body, "offsetHeight", {
    configurable: true,
    get: () => bodyHeight,
  });
  /** The browser lays out what renders, then reports the body's size. */
  function layOut(): void {
    bodyHeight = renderedLines() * LINE_HEIGHT;
    layout.set({ scrollHeight: bodyHeight });
    observers.fire((target) => panel.contains(target));
  }

  // The opening pin glides once, from the first size report after the
  // body is observed.
  await nextTick();
  layOut();
  await clock.advance(600);
  expect(layout.scrollTop()).toBe(layout.maxScrollTop());
  const openingFrames = clock.framesRun();
  const openingGlides = animations.glides.length;

  const scroll = callStats(animateScrollTop);
  scroll.reset();
  clock.resetFrames();
  layout.reset();
  const glidesBefore = animations.glides.length;
  const reads = layoutReadSpy();
  cleanups.push(() => reads.restore());
  let readsDuringReports = 0;
  const readCount = () => reads.computedStyleCalls() + reads.rectCalls();

  /** Last rendered `[source, final]` per Markdown render. */
  let lastRenders = new Map<object, [string, boolean]>();
  const snapshot = () => {
    const next = new Map<object, [string, boolean]>();
    for (const render of renders())
      next.set(render.vm.$, [
        render.props("source") as string,
        render.props("final") as boolean,
      ]);
    return next;
  };
  lastRenders = snapshot();
  /** Per panel update: Markdown chars re-rendered, and the allowed bound. */
  const updates: { chars: number; bound: number }[] = [];
  let lastText = renderedText();

  /**
   * Lays out and reports the size; the stub's own entry rectangles are not
   * the marker's reads.
   */
  function reportSize(): void {
    const before = readCount();
    layOut();
    readsDuringReports += readCount() - before;
  }

  /** Records the Markdown re-rendered since the previous check. */
  function recordUpdate(): void {
    const next = snapshot();
    let chars = 0;
    for (const [vm, [source, final]] of next) {
      const previous = lastRenders.get(vm);
      if (!previous || previous[0] !== source || previous[1] !== final)
        chars += source.length;
    }
    lastRenders = next;
    if (chars === 0) return;
    const text = renderedText();
    // Everything from the previous tail block's start is fair game.
    const tailStart = lastText.lastIndexOf("\n\n") + 2;
    updates.push({ chars, bound: text.length - tailStart });
    lastText = text;
  }

  /** One flush: a new line, its layout, the size report, then 120 ms. */
  async function flush(): Promise<void> {
    lines += 1;
    await wrapper.setProps({ message: thinkingMessage(lines) });
    recordUpdate();
    reportSize();
    await clock.advance(FLUSH_INTERVAL_MS);
    // A held-back update may have landed on its timer; lay it out too.
    recordUpdate();
    reportSize();
  }

  /** The pending trailing update lands and the panel reports its size. */
  async function settle(): Promise<void> {
    await clock.advance(THINKING_UPDATE_INTERVAL_MS);
    recordUpdate();
    reportSize();
    await clock.advance(FLUSH_INTERVAL_MS);
  }

  return {
    animations,
    body,
    clock,
    flush,
    settle,
    layout,
    panel,
    scroll,
    wrapper,
    openingFrames,
    openingGlides,
    lines: () => lines,
    updates: () => updates,
    streamGlides: () => animations.glides.slice(glidesBefore),
    layoutReads: () => ({
      computedStyle: reads.computedStyleCalls(),
      rect: reads.rectCalls(),
      outsideReports: readCount() - readsDuringReports,
    }),
    totalChars: () => renderedText().length,
  };
}

async function streamOneSecond() {
  const marker = await mountStreamingMarker();
  for (let index = 0; index < FLUSHES; index++) await marker.flush();
  const panelUpdates = marker.updates().length;
  await marker.settle();
  const updates = marker.updates();
  const metrics = {
    panelUpdates,
    allUpdates: updates.length,
    openingFrames: marker.openingFrames,
    openingGlides: marker.openingGlides,
    animateScrollTopCalls: marker.scroll.calls(),
    framesRun: marker.clock.framesRun(),
    scrollTopWrites: marker.layout.scrollTopWrites(),
    elementAnimateCalls: marker.streamGlides().length,
    endsAtBottom: marker.layout.scrollTop() === marker.layout.maxScrollTop(),
    maxCharsPerUpdate: Math.max(...updates.map(({ chars }) => chars)),
    totalChars: marker.totalChars(),
    layoutReadsOutsideReports: marker.layoutReads().outsideReports,
  };
  reportMetrics("thinking stream, 1 s", metrics);
  // The panel is open and shows the newest line.
  expect(marker.wrapper.get("button").attributes("aria-expanded")).toBe("true");
  expect(marker.panel.textContent).toContain(`Step ${marker.lines()}:`);
  return { marker, metrics };
}

describe("ProjectThinkingMarker streaming cost", () => {
  it("[T1] runs no scroll tween and no animation frame, opening pin included", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.animateScrollTopCalls).toBe(0);
    expect(metrics.framesRun).toBe(0);
    expect(metrics.openingFrames).toBe(0);
    expect(metrics.openingGlides).toBe(1);
  });

  it("[T2] writes the panel's scroll position at most once per update and ends at the bottom", async () => {
    const { metrics } = await streamOneSecond();
    expect(metrics.scrollTopWrites).toBeLessThanOrEqual(metrics.allUpdates);
    expect(metrics.endsAtBottom).toBe(true);
  });

  it("[T3] does not put a scroll-timeline fade on the panel", async () => {
    const marker = await mountStreamingMarker();
    reportMetrics("thinking panel classes", {
      hasScrollFade: marker.panel.classList.contains("scroll-fade"),
    });
    expect(marker.panel.classList.contains("scroll-fade")).toBe(false);
  });

  it("[T4] leaves no timer, frame or glide behind once thinking has collapsed", async () => {
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

    const running = marker.animations.glides.filter(
      (glide) => glide.playState === "running",
    ).length;
    reportMetrics("thinking collapsed, 600 ms later", {
      pendingTimers: marker.clock.pendingTimers(),
      pendingFrames: marker.clock.pendingFrames(),
      runningGlides: running,
      panelMounted: marker.wrapper.find("[data-thinking-content]").exists(),
    });
    expect(marker.wrapper.find("[data-thinking-content]").exists()).toBe(false);
    expect(marker.clock.pendingTimers()).toBe(0);
    expect(marker.clock.pendingFrames()).toBe(0);
    expect(running).toBe(0);
  });

  it("[T5] updates the streaming panel at most every 100 ms", async () => {
    const { marker, metrics } = await streamOneSecond();
    // 8 flushes 120 ms apart, slower than the 100 ms limit: each shows.
    expect(metrics.panelUpdates).toBeGreaterThanOrEqual(6);
    expect(metrics.panelUpdates).toBeLessThanOrEqual(8);
    // Nothing is lost: the held-back text lands.
    expect(marker.panel.textContent).toContain(`Step ${marker.lines()}:`);
  });

  it("[T6] glides with one transform animation on the body per update", async () => {
    const { marker, metrics } = await streamOneSecond();
    expect(metrics.elementAnimateCalls).toBeGreaterThan(0);
    expect(metrics.elementAnimateCalls).toBeLessThanOrEqual(metrics.allUpdates);
    for (const glide of marker.streamGlides()) {
      expect(glide.element).toBe(marker.body);
      for (const keyframe of glide.keyframes)
        expect(Object.keys(keyframe)).toEqual(["transform"]);
    }
  });

  it("[T7] re-renders only the Markdown block being written", async () => {
    const { marker, metrics } = await streamOneSecond();
    const updates = marker.updates();
    expect(updates.length).toBeGreaterThan(0);
    for (const { chars, bound } of updates)
      expect(chars).toBeLessThanOrEqual(bound);
    // A handful of ~40-character blocks, never the whole ~700-character text.
    expect(metrics.maxCharsPerUpdate).toBeLessThan(metrics.totalChars / 4);
  });

  it("[T8] reads no computed style or element rectangle of its own", async () => {
    const { marker } = await streamOneSecond();
    const reads = marker.layoutReads();
    reportMetrics("thinking layout reads", reads);
    expect(reads.outsideReports).toBe(0);
  });
});
