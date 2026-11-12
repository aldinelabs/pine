/*
 * BASELINE: measured before any perf change, on a fake 60 Hz clock. The new
 * conversation background (`ProjectSessionParallaxBackground`, which wraps
 * `ParallaxFloat`) is mounted on its own, as a draft tab shows it.
 *
 * | id | scenario                     | metric                              | measured | target |
 * | -- | ---------------------------- | ----------------------------------- | -------- | ------ |
 * | I1 | mounted, pointer never moves | frames run in the 2nd second        | 63       | 0      |
 * | I2 | `active` false               | frames run in 1 s after mount frame | 62       | 0      |
 * | I2 |                              | frames run in 1 s after a mousemove | 63       | 0      |
 * | I3 | active, one 40 px mousemove  | frames run in the next 2 s          | 125      | > 0    |
 * | I3 |                              | frames run in the 500 ms after that | 31       | 0      |
 *
 * Holds today: none. Not met yet (`it.fails`): I1, I2, I3. When a change
 * makes one hold, turn it into `it` and update the measured column.
 *
 * I3's pointer move displaces the deepest layer by 1.9 px. Easing 5 % of the
 * remaining distance per frame, it is within 0.01 px of rest after 102 frames
 * (1.6 s), so a loop that stops when settled fits the two seconds.
 *
 * Print the metrics with `PINE_PERF_LOG=1` (add `--reporter=default` when
 * vitest hides the output of passing tests).
 */
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  FRAME_MS,
  frameClock,
  reportMetrics,
} from "@/__tests__/perf/streamHarness";
import ProjectSessionParallaxBackground from "../ProjectSessionParallaxBackground.vue";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** `active` is passed as an attribute until the component declares it. */
function mountBackground(attrs: Record<string, unknown> = {}) {
  const clock = frameClock();
  const wrapper: VueWrapper = mount(ProjectSessionParallaxBackground, {
    attrs,
    attachTo: document.body,
  });
  cleanups.push(
    () => clock.restore(),
    () => wrapper.unmount(),
  );
  const iconTransforms = () =>
    wrapper
      .findAll<HTMLElement>("[data-parallax-icon]")
      .map((icon) => icon.element.style.transform);
  return { clock, iconTransforms, wrapper };
}

/** The pointer moves 40 px right and 30 px down of the background's centre. */
function movePointer(): void {
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 40, clientY: 30 }),
  );
}

describe("idle animation loops", () => {
  it.fails(
    "[I1] runs no frame for a background nobody moves the pointer over",
    async () => {
      const { clock, wrapper } = mountBackground();
      await clock.advance(1_000);
      const firstSecond = clock.framesRun();
      clock.resetFrames();
      await clock.advance(1_000);

      reportMetrics("I1 idle background", {
        framesInFirstSecond: firstSecond,
        framesInSecondSecond: clock.framesRun(),
      });
      // It did mount and reveal its icons.
      expect(wrapper.findAll("[data-parallax-icon]").length).toBeGreaterThan(0);
      expect(clock.framesRun()).toBe(0);
      expect(clock.pendingFrames()).toBe(0);
    },
  );

  it.fails(
    "[I2] runs no frame while inactive, also when the pointer moves",
    async () => {
      const { clock } = mountBackground({ active: false });
      // The reveal transition needs the frame after mount.
      await clock.advance(2 * FRAME_MS);
      clock.resetFrames();
      await clock.advance(1_000);
      const idle = clock.framesRun();

      clock.resetFrames();
      movePointer();
      await clock.advance(1_000);

      reportMetrics("I2 inactive background", {
        framesWhileIdle: idle,
        framesAfterMousemove: clock.framesRun(),
      });
      expect(idle).toBe(0);
      expect(clock.framesRun()).toBe(0);
      expect(clock.pendingFrames()).toBe(0);
    },
  );

  it.fails(
    "[I3] animates after a pointer move and stops again within two seconds",
    async () => {
      const { clock, iconTransforms } = mountBackground();
      await clock.advance(1_000);
      const before = iconTransforms();

      clock.resetFrames();
      movePointer();
      await clock.advance(2_000);
      const moving = clock.framesRun();
      const after = iconTransforms();

      clock.resetFrames();
      await clock.advance(500);

      reportMetrics("I3 pointer move", {
        framesInTwoSecondsAfterMove: moving,
        framesInTheNext500Ms: clock.framesRun(),
      });
      // The layers followed the pointer.
      expect(moving).toBeGreaterThan(0);
      expect(after).not.toEqual(before);
      // And came to rest.
      expect(clock.framesRun()).toBe(0);
      expect(clock.pendingFrames()).toBe(0);
    },
  );
});
