import { toValue, watch, type MaybeRefOrGetter } from "vue";

/**
 * The elements whose transitions follow the moving window edge: both
 * sidebars' gap and container, and anything marked as a follower.
 */
export const WINDOW_EDGE_FOLLOWERS =
  '[data-slot="sidebar-container"], [data-slot="sidebar-gap"], [data-window-edge-follower]';

/**
 * Delays the followers' transitions by `delay` ms (none while null), so they
 * share the window animation's timeline.
 *
 * The delay is written onto each follower rather than set as a custom
 * property on the layout root: custom properties inherit, so changing one
 * there restyles every element in the window, which stalls the first frames
 * of the animation.
 */
export function useWindowEdgeTransitionDelay(
  root: MaybeRefOrGetter<Element | null | undefined>,
  delay: MaybeRefOrGetter<number | null>,
): void {
  watch(
    () => [toValue(root), toValue(delay)] as const,
    ([element, ms]) => {
      if (!element) return;
      const value = ms === null ? "" : `${ms}ms`;
      for (const follower of element.querySelectorAll<HTMLElement>(
        WINDOW_EDGE_FOLLOWERS,
      ))
        follower.style.transitionDelay = value;
    },
  );
}
