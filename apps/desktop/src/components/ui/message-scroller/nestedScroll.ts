import type { MessageScrollerScrollDirection } from "./useMessageScroller";

/** Matches the scroller's own sub-pixel tolerance at a scroll edge. */
const EDGE_EPSILON = 0.5;

/**
 * Whether vertical input aimed at `target` is taken by a scrollable element
 * nested inside `root` (such as the live thinking panel) instead of reaching
 * `root`. Such an element scrolls itself while it has room in `direction`,
 * and one with `overscroll-behavior-y` other than `auto` never hands the rest
 * on. Input it takes leaves the transcript where it is, so it must not count
 * as the reader scrolling the transcript.
 */
export function nestedScrollerTakes(
  target: EventTarget | null,
  root: HTMLElement,
  direction: MessageScrollerScrollDirection,
): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== root && root.contains(element)) {
    if (
      element instanceof HTMLElement &&
      element.scrollHeight - element.clientHeight > EDGE_EPSILON
    ) {
      const style = window.getComputedStyle(element);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        if (style.overscrollBehaviorY && style.overscrollBehaviorY !== "auto")
          return true;
        const room =
          direction === "start"
            ? element.scrollTop
            : element.scrollHeight - element.clientHeight - element.scrollTop;
        if (room > EDGE_EPSILON) return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}
