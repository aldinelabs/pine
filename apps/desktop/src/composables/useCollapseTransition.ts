/** The app-wide transition length; see `duration-500` throughout the UI. */
const DURATION_MS = 500;
/** Fallback for `--ease-out-expo` when the stylesheet is unavailable. */
const EASE_OUT_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

export type CollapseAxis = "height" | "both";

function easing(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--ease-out-expo")
    .trim();
  return value || EASE_OUT_EXPO;
}

function sizeFrame(
  element: HTMLElement,
  axis: CollapseAxis,
): Keyframe & { opacity: number } {
  const { height, width } = element.getBoundingClientRect();
  return {
    height: `${height}px`,
    ...(axis === "both" ? { width: `${width}px` } : {}),
    opacity: 1,
  };
}

function collapsedFrame(axis: CollapseAxis): Keyframe {
  return {
    height: "0px",
    ...(axis === "both" ? { width: "0px" } : {}),
    opacity: 0,
  };
}

function run(element: HTMLElement, frames: Keyframe[], done: () => void): void {
  if (typeof element.animate !== "function") {
    done();
    return;
  }
  for (const animation of element.getAnimations()) animation.cancel();
  // Clips the content while the box is smaller than it.
  element.style.overflow = "hidden";
  const animation = element.animate(frames, {
    duration: DURATION_MS,
    easing: easing(),
  });
  animation.addEventListener(
    "finish",
    () => {
      element.style.overflow = "";
      done();
    },
    { once: true },
  );
  animation.addEventListener(
    "cancel",
    () => {
      element.style.overflow = "";
    },
    { once: true },
  );
}

/**
 * `<Transition :css="false">` hooks that grow an element from nothing and
 * shrink it back, so the content around it glides instead of jumping when
 * it appears or goes. `both` also animates the width, for side-by-side items.
 */
export function useCollapseTransition(axis: CollapseAxis = "height") {
  return {
    onEnter(element: Element, done: () => void): void {
      if (!(element instanceof HTMLElement)) return done();
      run(element, [collapsedFrame(axis), sizeFrame(element, axis)], done);
    },
    onLeave(element: Element, done: () => void): void {
      if (!(element instanceof HTMLElement)) return done();
      run(element, [sizeFrame(element, axis), collapsedFrame(axis)], done);
    },
  };
}
