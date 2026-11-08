import { afterEach, describe, expect, it, vi } from "vitest";
import { animateScrollTop, easeOutExpo } from "../animateScroll";

interface FrameClock {
  now: () => number;
  flush: (ms: number) => void;
}

function installFrameClock(): FrameClock {
  const queue = new Map<number, (now: number) => void>();
  let handle = 0;
  let time = 0;
  vi.stubGlobal("performance", { now: () => time });
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    queue.set(++handle, callback);
    return handle;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  return {
    now: () => time,
    flush(ms: number) {
      const end = time + ms;
      while (time < end) {
        time += 16;
        for (const [id, callback] of [...queue]) {
          if (queue.has(id)) {
            queue.delete(id);
            callback(time);
          }
        }
      }
    },
  };
}

function createScroller(initialTop = 0): HTMLElement {
  const element = document.createElement("div");
  let top = initialTop;
  Object.defineProperty(element, "scrollTop", {
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  return element;
}

describe("easeOutExpo", () => {
  it("matches the shared cubic-bezier endpoints", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
  });

  it("starts fast like the expo curve and stays monotonic within bounds", () => {
    // At ~15% of the sweep, cubic-bezier(0.16, 1, 0.3, 1) is already past 55%.
    expect(easeOutExpo(0.15)).toBeGreaterThan(0.55);
    let previous = 0;
    for (let step = 0; step <= 20; step++) {
      const value = easeOutExpo(step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
});

describe("animateScrollTop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sweeps toward the target along the easing and lands exactly on it", () => {
    const clock = installFrameClock();
    const element = createScroller();
    animateScrollTop(element, 1000);
    clock.flush(150);
    const midTop = element.scrollTop;
    expect(midTop).toBeGreaterThan(500);
    expect(midTop).toBeLessThan(1000);
    clock.flush(400);
    expect(element.scrollTop).toBe(1000);
  });

  it("retargets from the current position when called again", () => {
    const clock = installFrameClock();
    const element = createScroller();
    animateScrollTop(element, 1000);
    clock.flush(80);
    animateScrollTop(element, 200);
    clock.flush(600);
    expect(element.scrollTop).toBe(200);
  });

  it("keeps the original arrival time when the same target is measured again", () => {
    const clock = installFrameClock();
    const element = createScroller();
    const cancel = animateScrollTop(element, 1000);
    clock.flush(250);
    expect(animateScrollTop(element, 1000)).toBe(cancel);
    clock.flush(260);
    expect(element.scrollTop).toBe(1000);
  });

  it("does not let an old cancellation remove a newer animation", () => {
    const clock = installFrameClock();
    const element = createScroller();
    const cancel = animateScrollTop(element, 1000);
    clock.flush(80);
    const currentCancel = animateScrollTop(element, 200);
    cancel();
    expect(animateScrollTop(element, 200)).toBe(currentCancel);
    element.dispatchEvent(new Event("wheel"));
    const stoppedAt = element.scrollTop;
    clock.flush(600);
    expect(element.scrollTop).toBe(stoppedAt);
  });

  it("compensates for a collapsing layout anchor without adding another tween", () => {
    const clock = installFrameClock();
    const element = createScroller(800);
    animateScrollTop(element, 1000, { preserveAnchor: true });
    expect(element.scrollTop).toBe(1000);
    // An already placed anchor must stay fixed as thinking above it folds.
    animateScrollTop(element, 900, { preserveAnchor: true });
    expect(element.scrollTop).toBe(900);
    clock.flush(600);
    expect(element.scrollTop).toBe(900);
  });

  it("rebases a moving anchor while keeping an arrival tween's remaining distance and clock", () => {
    const clock = installFrameClock();
    const element = createScroller();
    const cancel = animateScrollTop(element, 1000);
    clock.flush(250);
    const painted = element.scrollTop;
    // A layout shrink may clamp scrollTop before the resize callback.
    element.scrollTop = painted - 50;
    expect(animateScrollTop(element, 900, { preserveAnchor: true })).toBe(
      cancel,
    );
    expect(element.scrollTop).toBeCloseTo(painted - 100);
    clock.flush(260);
    expect(element.scrollTop).toBe(900);
  });

  it("jumps instantly under prefers-reduced-motion", () => {
    installFrameClock();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    const element = createScroller();
    animateScrollTop(element, 800);
    expect(element.scrollTop).toBe(800);
  });
});
