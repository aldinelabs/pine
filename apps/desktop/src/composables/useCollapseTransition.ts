import { DURATION_MS, EASE_IN_OUT_EXPO, EASE_OUT_EXPO } from "@/lib/motion";

/** Making and giving back room; the out curve has all but settled by half. */
const ROOM_MS = DURATION_MS;
/** Blurring and scaling the element in or out. */
const REVEAL_MS = 400;
/** The reveal starts once the room is all but made. */
const REVEAL_DELAY_MS = 200;
/** The room closes once the element is all but gone. */
const CLOSE_DELAY_MS = 350;

const HIDDEN: Keyframe = {
  opacity: 0,
  transform: "scale(0.92)",
  filter: "blur(8px)",
};
const SHOWN: Keyframe = {
  opacity: 1,
  transform: "scale(1)",
  filter: "blur(0px)",
};

/**
 * Which way the element makes room. `height` always does, for the content
 * below or above it; `width` only beside a neighbour, which slides aside.
 */
export type CollapseAxis = "height" | "width";

interface Step {
  from: Keyframe;
  to: Keyframe;
  options: KeyframeAnimationOptions;
}

/** The side a neighbour sits on, whose flex gap folds away with the element. */
function neighbourSide(
  element: HTMLElement,
): "marginInlineStart" | "marginInlineEnd" | null {
  if (element.previousElementSibling) return "marginInlineStart";
  if (element.nextElementSibling) return "marginInlineEnd";
  return null;
}

/** The element's room, from none to its full size; null when it needs none. */
function room(
  element: HTMLElement,
  axis: CollapseAxis,
): [Keyframe, Keyframe] | null {
  const { height, width } = element.getBoundingClientRect();
  if (axis === "height") return [{ height: "0px" }, { height: `${height}px` }];
  const side = neighbourSide(element);
  if (!side) return null;
  const parent = element.parentElement;
  const gap = parent
    ? Number.parseFloat(getComputedStyle(parent).columnGap) || 0
    : 0;
  return [
    { width: "0px", [side]: `${-gap}px` },
    { width: `${width}px`, [side]: "0px" },
  ];
}

/** Room is made, then the element blurs and scales in. */
function enterSteps(element: HTMLElement, axis: CollapseAxis): Step[] {
  const frames = room(element, axis);
  const reveal: Step = {
    from: HIDDEN,
    to: SHOWN,
    options: {
      duration: REVEAL_MS,
      easing: EASE_IN_OUT_EXPO,
      delay: frames ? REVEAL_DELAY_MS : 0,
      // Hidden while the room is made.
      fill: "backwards",
    },
  };
  if (!frames) return [reveal];
  const [from, to] = frames;
  return [
    { from, to, options: { duration: ROOM_MS, easing: EASE_OUT_EXPO } },
    reveal,
  ];
}

/** The element blurs and scales out, then its room closes. */
function leaveSteps(element: HTMLElement, axis: CollapseAxis): Step[] {
  const frames = room(element, axis);
  // Both hold their end until the element is removed.
  const conceal: Step = {
    from: SHOWN,
    to: HIDDEN,
    options: {
      duration: REVEAL_MS,
      easing: EASE_IN_OUT_EXPO,
      fill: "forwards",
    },
  };
  if (!frames) return [conceal];
  const [to, from] = frames;
  return [
    conceal,
    {
      from,
      to,
      options: {
        duration: ROOM_MS,
        easing: EASE_OUT_EXPO,
        delay: CLOSE_DELAY_MS,
        fill: "forwards",
      },
    },
  ];
}

function cancel(element: HTMLElement): boolean {
  if (typeof element.animate !== "function") return false;
  for (const animation of element.getAnimations()) animation.cancel();
  return true;
}

function run(steps: Step[], element: HTMLElement, done: () => void): void {
  let pending = steps.length;
  for (const { from, to, options } of steps) {
    element.animate([from, to], options).addEventListener(
      "finish",
      () => {
        pending -= 1;
        if (pending === 0) done();
      },
      { once: true },
    );
  }
}

/**
 * `<Transition :css="false">` hooks for an element that makes room before it
 * blurs in, and blurs out before its room closes, so the content around it
 * glides rather than jumps. The element is invisible while its room changes,
 * so nothing needs clipping.
 */
export function useCollapseTransition(axis: CollapseAxis = "height") {
  return {
    onEnter: (element: Element, done: () => void): void => {
      if (!(element instanceof HTMLElement) || !cancel(element)) return done();
      run(enterSteps(element, axis), element, done);
    },
    onLeave: (element: Element, done: () => void): void => {
      if (!(element instanceof HTMLElement) || !cancel(element)) return done();
      run(leaveSteps(element, axis), element, done);
    },
  };
}
