/*
 * BASELINE: measured on the scroller before any perf change. The real engine,
 * viewport, content and items run on a fake 60 Hz clock with stubbed layout
 * (viewport 600 px tall). The scroller follows the bottom with the animated
 * glide a streaming turn uses, and holds a visibility consumer as the
 * transcript outline does. One second of streaming is simulated: 8 content
 * resizes 120 ms apart, 44 px each, so the engine's own follow tween never
 * comes to rest.
 *
 * | id | metric                                                    | baseline | now    | target   |
 * | -- | --------------------------------------------------------- | -------- | ------ | -------- |
 * | L1 | getComputedStyle calls in 6 tween frames after the first  | 5        | 0      | 0        |
 * | L2 | frame time for animateScrollTop to finish a 20 px sweep   | 512 ms   | 272 ms | < 400 ms |
 * | L2 | first frame within 0.5 px of that target                  | 272 ms   | 272 ms | -        |
 * | L3 | passes of layout reads on message items in 1 s of follow  | 60       | 10     | <= 12    |
 * | -  | rectangle reads on message items in that second           | 125      | 10     | -        |
 * | -  | rectangle reads on any element in that second             | 258      | 28     | -        |
 * | -  | getComputedStyle calls in that second                     | 67       | 1      | -        |
 * | -  | animation frame callbacks run in that second              | 184      | 135    | -        |
 * | -  | scrollTop writes in that second                           | 60       | 60     | -        |
 *
 * Holds now: L1, L2, L3 (the follow tween skips the content measurement,
 * spaces its visibility passes 100 ms apart with a trailing pass, and lands
 * once less than half a pixel is left). Not met yet: none.
 *
 * A pass is one simulated instant at which message items were measured. The
 * stubbed viewport reports a scroll the way a browser does, at the start of
 * the frame after the write; at baseline that event made the viewport
 * measure again on every frame of the tween. (L1 counted 5, not 6, because
 * the event for the first tween frame arrives one frame later.)
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRAME_MS,
  frameClock,
  intersectionObserverStub,
  layoutReadSpy,
  layoutStub,
  reportMetrics,
  resizeObserverStub,
} from "@/__tests__/perf/streamHarness";
import { animateScrollTop, easeOutExpo } from "@/lib/animateScroll";
import MessageScrollerContent from "../MessageScrollerContent.vue";
import MessageScrollerItem from "../MessageScrollerItem.vue";
import MessageScrollerViewport from "../MessageScrollerViewport.vue";
import {
  provideMessageScroller,
  type MessageScrollerContext,
} from "../useMessageScroller";

const MESSAGES = 12;
const VIEWPORT_HEIGHT = 600;
const LINE_HEIGHT = 44;
const FLUSHES = 8;
const FLUSH_INTERVAL_MS = 120;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function isMessageItem(element: Element): boolean {
  return element.matches('[data-slot="message-scroller-item"]');
}

/** A transcript pinned to its live end while a turn streams. */
async function mountFollowingScroller() {
  const clock = frameClock();
  const resizes = resizeObserverStub();
  const intersections = intersectionObserverStub();
  let context: MessageScrollerContext | undefined;
  const wrapper: VueWrapper = mount(
    defineComponent({
      setup() {
        const engine = provideMessageScroller({
          autoScroll: true,
          followAnimated: true,
        });
        context = engine.context;
        // The transcript outline keeps the visibility state alive.
        engine.context.acquireVisibility();
        return () =>
          h(MessageScrollerViewport, null, {
            default: () =>
              h(MessageScrollerContent, null, {
                default: () =>
                  Array.from({ length: MESSAGES }, (_, index) =>
                    h(
                      MessageScrollerItem,
                      {
                        key: index,
                        messageId: `message-${index}`,
                        scrollAnchor: index % 2 === 0,
                      },
                      { default: () => `Message ${index}` },
                    ),
                  ),
              }),
          });
      },
    }),
    { attachTo: document.body },
  );
  cleanups.push(
    () => clock.restore(),
    () => resizes.restore(),
    () => intersections.restore(),
    () => wrapper.unmount(),
  );
  const viewport = wrapper.get<HTMLElement>(
    '[data-slot="message-scroller-viewport"]',
  ).element;
  const content = wrapper.get<HTMLElement>(
    '[data-slot="message-scroller-content"]',
  ).element;
  let contentHeight = 2_400;
  const layout = layoutStub(viewport, {
    scrollHeight: contentHeight,
    clientHeight: VIEWPORT_HEIGHT,
  });
  // The last three messages are on screen; one of them is a user turn.
  const items = wrapper.findAll('[data-slot="message-scroller-item"]');
  const onScreen = new Set(items.slice(-3).map((item) => item.element));
  intersections.report((target) => onScreen.has(target));

  /** The reply grows by a line and the browser reports the new height. */
  function grow(): void {
    contentHeight += LINE_HEIGHT;
    layout.set({ scrollHeight: contentHeight });
    resizes.fire((target) => target === content);
  }

  // Reach the live end and let the opening glide come to rest.
  grow();
  await clock.advance(1_000);
  if (!context) throw new Error("The scroller did not mount.");
  expect(context.isFollowingBottom()).toBe(true);
  expect(layout.scrollTop()).toBe(layout.maxScrollTop());
  expect(clock.pendingFrames()).toBe(0);

  const reads = layoutReadSpy();
  cleanups.push(() => reads.restore());
  clock.resetFrames();
  layout.reset();
  return { clock, context, grow, layout, reads };
}

describe("message scroller follow loop cost", () => {
  it("[L1] reads no computed style on the frames of its own follow tween", async () => {
    const scroller = await mountFollowingScroller();
    scroller.grow();
    await scroller.clock.advance(FRAME_MS);
    const start = scroller.layout.scrollTop();
    scroller.reads.reset();
    scroller.clock.resetFrames();
    await scroller.clock.advance(6 * FRAME_MS);

    reportMetrics("L1 follow tween frames", {
      frameCallbacks: scroller.clock.framesRun(),
      computedStyleCalls: scroller.reads.computedStyleCalls(),
    });
    // The tween is still gliding toward the new end.
    expect(scroller.layout.scrollTop()).toBeGreaterThan(start);
    expect(scroller.layout.scrollTop()).toBeLessThan(
      scroller.layout.maxScrollTop(),
    );
    expect(scroller.context.isFollowingBottom()).toBe(true);
    expect(scroller.reads.computedStyleCalls()).toBe(0);
  });

  it("[L2] ends a 20 px sweep in under 400 ms", async () => {
    const clock = frameClock();
    cleanups.push(() => clock.restore());
    const element = document.createElement("div");
    const layout = layoutStub(element, { scrollHeight: 1_000, clientHeight: 400 });
    let withinHalfPixelAt = 0;
    while (20 * (1 - easeOutExpo(withinHalfPixelAt / 500)) >= 0.5)
      withinHalfPixelAt += FRAME_MS;

    const started = clock.now();
    animateScrollTop(element, 20);
    while (clock.pendingFrames() > 0 && clock.now() - started < 2_000)
      await clock.advance(FRAME_MS);
    const finishedAfter = clock.now() - started;

    reportMetrics("L2 20 px sweep", {
      finishedAfterMs: finishedAfter,
      withinHalfPixelAfterMs: withinHalfPixelAt,
      frameCallbacks: clock.framesRun(),
    });
    expect(layout.scrollTop()).toBe(20);
    expect(clock.pendingFrames()).toBe(0);
    expect(finishedAfter).toBeLessThan(400);
  });

  it("[L3] measures message items on at most 12 passes per second of follow", async () => {
    const scroller = await mountFollowingScroller();
    for (let flush = 0; flush < FLUSHES; flush++) {
      scroller.grow();
      await scroller.clock.advance(FLUSH_INTERVAL_MS);
    }
    const passes = scroller.reads.rectPasses(isMessageItem);

    reportMetrics("L3 one second of follow", {
      itemLayoutPasses: passes,
      itemRectReads: scroller.reads.rectCalls(isMessageItem),
      rectReads: scroller.reads.rectCalls(),
      computedStyleCalls: scroller.reads.computedStyleCalls(),
      frameCallbacks: scroller.clock.framesRun(),
      scrollTopWrites: scroller.layout.scrollTopWrites(),
    });
    // It kept gliding after the growing reply the whole time.
    expect(scroller.context.isFollowingBottom()).toBe(true);
    expect(scroller.layout.scrollTop()).toBeGreaterThan(
      scroller.layout.maxScrollTop() - FLUSHES * LINE_HEIGHT,
    );
    expect(passes).toBeLessThanOrEqual(12);

    // And it still arrives at the live end once the stream stops.
    await scroller.clock.advance(1_000);
    expect(scroller.layout.scrollTop()).toBe(scroller.layout.maxScrollTop());
  });
});
