/**
 * Scroll tweening that mirrors the app's shared expand/collapse easing,
 * `--ease-out-expo` (cubic-bezier(0.16, 1, 0.3, 1)) from index.css. Native
 * `scrollTo({ behavior: "smooth" })` cannot take a custom curve, so programmatic
 * scrolls animate with the same solver instead.
 */

const EASE_OUT_EXPO_CONTROL_POINTS = {
  x1: 0.16,
  y1: 1,
  x2: 0.3,
  y2: 1,
} as const;

/** Polynomial coefficients for the cubic Bézier axis: (at³ + bt² + ct). */
function bezierAxisCoefficients(
  point1: number,
  point2: number,
): {
  a: number;
  b: number;
  c: number;
} {
  return {
    a: 1 - 3 * point2 + 3 * point1,
    b: 3 * point2 - 6 * point1,
    c: 3 * point1,
  };
}

function sampleBezierAxis(
  coefficients: { a: number; b: number; c: number },
  t: number,
): number {
  return ((coefficients.a * t + coefficients.b) * t + coefficients.c) * t;
}

/** Progress along cubic-bezier(0.16, 1, 0.3, 1) for a time in [0, 1]. */
export function easeOutExpo(time: number): number {
  const clamped = Math.min(1, Math.max(0, time));
  if (clamped === 0 || clamped === 1) return clamped;
  const x = bezierAxisCoefficients(
    EASE_OUT_EXPO_CONTROL_POINTS.x1,
    EASE_OUT_EXPO_CONTROL_POINTS.x2,
  );
  const y = bezierAxisCoefficients(
    EASE_OUT_EXPO_CONTROL_POINTS.y1,
    EASE_OUT_EXPO_CONTROL_POINTS.y2,
  );
  // Solve the horizontal axis for `time` with Newton–Raphson, falling back to
  // bisection when the derivative is flat near our fast-start control points.
  let parameter = clamped;
  for (let i = 0; i < 8; i++) {
    const currentX = sampleBezierAxis(x, parameter) - clamped;
    if (Math.abs(currentX) < 1e-6) return sampleBezierAxis(y, parameter);
    const derivative = (3 * x.a * parameter + 2 * x.b) * parameter + x.c;
    if (Math.abs(derivative) < 1e-6) break;
    parameter -= currentX / derivative;
  }
  let lower = 0;
  let upper = 1;
  parameter = clamped;
  while (lower < upper) {
    const currentX = sampleBezierAxis(x, parameter);
    if (Math.abs(currentX - clamped) < 1e-6) break;
    if (currentX < clamped) lower = parameter;
    else upper = parameter;
    parameter = (lower + upper) / 2;
  }
  return sampleBezierAxis(y, parameter);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const DEFAULT_DURATION_MS = 500;
/** Remaining distance below which a tween lands on its target. */
const FINISH_DISTANCE_PX = 0.5;

export interface AnimateScrollTopOptions {
  /** Sweep duration in milliseconds (default 500). */
  duration?: number;
  /** Compensate for a moving layout anchor on the current tween's clock.
   * When idle, restore its position immediately instead of starting a tween. */
  preserveAnchor?: boolean;
}

type CancelAnimation = () => void;

/**
 * One in-flight animation per element: calling again retargets from wherever
 * the element currently is, which is what a streaming follow-scroll wants.
 * Wheel / touch input cancels the animation so the reader always wins.
 */
const activeAnimations = new WeakMap<
  HTMLElement,
  {
    target: number;
    cancel: CancelAnimation;
    retargetAnchor: (top: number) => void;
  }
>();

const USER_INPUT_EVENTS = ["wheel", "touchstart"] as const;

export function animateScrollTop(
  element: HTMLElement,
  top: number,
  options: AnimateScrollTopOptions = {},
): CancelAnimation {
  let target = Math.max(0, Math.round(top));
  const active = activeAnimations.get(element);
  // Resize observers often report the same anchor during a send. Keep its
  // original clock so repeated measurements do not restart the motion.
  if (active?.target === target) return active.cancel;
  if (active && options.preserveAnchor) {
    active.retargetAnchor(target);
    return active.cancel;
  }
  active?.cancel();
  const distance = target - element.scrollTop;
  let finished = false;

  function cleanup(): void {
    if (finished) return;
    finished = true;
    for (const event of USER_INPUT_EVENTS) {
      element.removeEventListener(event, handleUserInput);
    }
    if (frame !== null) window.cancelAnimationFrame(frame);
    activeAnimations.delete(element);
  }

  function handleUserInput(): void {
    cleanup();
  }

  if (
    options.preserveAnchor ||
    prefersReducedMotion() ||
    Math.abs(distance) < 1
  ) {
    element.scrollTop = target;
    return () => {};
  }

  const duration = options.duration ?? DEFAULT_DURATION_MS;
  let startTop = element.scrollTop;
  let lastTop = startTop;
  const startTime = performance.now();
  let frame: number | null = null;

  function step(now: number): void {
    frame = null;
    const progress = easeOutExpo((now - startTime) / duration);
    lastTop = startTop + (target - startTop) * progress;
    // The ease-out tail spends its last stretch on sub-pixel steps that
    // paint nothing new. Land on the target once less than half a pixel is
    // left instead of running a frame loop for them.
    if (
      now - startTime >= duration ||
      Math.abs(target - lastTop) < FINISH_DISTANCE_PX
    ) {
      element.scrollTop = target;
      cleanup();
      return;
    }
    element.scrollTop = lastTop;
    frame = window.requestAnimationFrame(step);
  }

  for (const event of USER_INPUT_EVENTS) {
    element.addEventListener(event, handleUserInput, { passive: true });
  }
  activeAnimations.set(element, {
    get target() {
      return target;
    },
    cancel: cleanup,
    retargetAnchor(next) {
      const delta = next - target;
      target = next;
      startTop += delta;
      lastTop += delta;
      // Use the last painted position: the browser may already have clamped
      // scrollTop when content shrank, before ResizeObserver could restore it.
      element.scrollTop = lastTop;
    },
  });
  frame = window.requestAnimationFrame(step);

  return cleanup;
}

/** Whether a tween started by animateScrollTop is still moving the element. */
export function isScrollAnimating(element: HTMLElement): boolean {
  return activeAnimations.has(element);
}
