import { onScopeDispose } from "vue";
import { easeOutExpo, prefersReducedMotion } from "@/lib/animateScroll";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";

/**
 * Follows the end of growing content with a glide that runs on the
 * compositor (FLIP): each move writes the scroll position once, then slides
 * the content from where it was on screen to its new place with a transform
 * animation. Nothing runs per frame on the main thread, and a move that
 * arrives mid-glide carries on from the position on screen.
 */
export interface FlipFollowScroll {
  /**
   * Moves the scroller to `top` with one write and glides `content` from
   * where it was on screen. Call it from a ResizeObserver callback, where
   * layout is already computed, so neither the scroll read nor the write
   * forces a layout.
   */
  glideTo(top: number): void;
  /** The user took over or the panel folds: stop, keeping the on-screen position (one write). */
  interrupt(): void;
  /** Drops any glide without touching the scroll position (unmount). */
  cancel(): void;
  /** On-screen offset of the running glide in px (0 when idle). */
  offset(): number;
  isGliding(): boolean;
}

export interface FlipFollowScrollOptions {
  scroller: () => HTMLElement | null | undefined;
  /** The element that slides; it must sit inside `scroller`. */
  content: () => HTMLElement | null | undefined;
  duration?: number;
  reducedMotion?: () => boolean;
}

/** Below this distance a glide would not show; the write alone lands it. */
const MIN_GLIDE_PX = 1;

export function createFlipFollowScroll(
  options: FlipFollowScrollOptions,
): FlipFollowScroll {
  const duration = options.duration ?? DURATION_MS;
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  let animation: Animation | undefined;
  let animationContent: HTMLElement | undefined;
  let startOffset = 0;

  /**
   * Worked out from the animation's own clock and the same curve the
   * compositor runs, so no computed style or rectangle is read.
   */
  function offset(): number {
    if (!animation || animation.playState === "finished") return 0;
    const time = animation.currentTime;
    // Not started yet (pending): the first keyframe is what shows.
    if (time === null) return startOffset;
    const elapsed = typeof time === "number" ? time : 0;
    return startOffset * (1 - easeOutExpo(Math.min(1, elapsed / duration)));
  }

  function cancel(): void {
    const running = animation;
    animation = undefined;
    animationContent = undefined;
    startOffset = 0;
    // A finished glide has already let go of the transform.
    if (running && running.playState !== "finished") running.cancel();
  }

  function glideTo(top: number): void {
    const scroller = options.scroller();
    if (!scroller) return;
    const content = options.content();
    if (content !== animationContent) cancel();
    const before = scroller.scrollTop;
    const visualBefore = before - offset();
    if (top !== before) scroller.scrollTo({ top, behavior: "instant" });
    // The write clamps to the scroll range; glide to where it landed.
    const actualTop = top === before ? before : scroller.scrollTop;
    cancel();
    const from = actualTop - visualBefore;
    if (
      !content ||
      Math.abs(from) < MIN_GLIDE_PX ||
      typeof content.animate !== "function" ||
      reducedMotion()
    )
      return;
    const next = content.animate(
      [{ transform: `translateY(${from}px)` }, { transform: "none" }],
      { duration, easing: EASE_OUT_EXPO },
    );
    animation = next;
    animationContent = content;
    startOffset = from;
    next.addEventListener(
      "finish",
      () => {
        if (animation !== next) return;
        animation = undefined;
        animationContent = undefined;
        startOffset = 0;
      },
      { once: true },
    );
  }

  function interrupt(): void {
    if (!animation) return;
    const shown = offset();
    const scroller = options.scroller();
    // Read before the transform goes, while layout is still clean.
    const top = scroller?.scrollTop ?? 0;
    cancel();
    if (!scroller || shown === 0) return;
    scroller.scrollTo({ top: top - shown, behavior: "instant" });
  }

  return {
    glideTo,
    interrupt,
    cancel,
    offset,
    isGliding: () => offset() !== 0,
  };
}

/** `createFlipFollowScroll`, cancelled when the owning scope ends. */
export function useFlipFollowScroll(
  options: FlipFollowScrollOptions,
): FlipFollowScroll {
  const follow = createFlipFollowScroll(options);
  onScopeDispose(() => follow.cancel());
  return follow;
}
