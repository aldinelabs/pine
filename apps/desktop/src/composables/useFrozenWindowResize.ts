import { nextTick, readonly, ref } from "vue";
import type { PineWindowResizeRequest } from "@/shared/window";

interface FrozenResizeHooks {
  /** Runs while frozen, before the window starts moving. */
  beforeCommit?: (delta: number) => void;
  /**
   * Runs when the window animation starts; start matching CSS transitions
   * here, delayed by `transitionDelay` so they share the window's timeline.
   */
  onCommitStart?: (delta: number) => void;
  /** Runs in the same tick as the unfreeze, so both land in one layout. */
  afterCommit?: () => void;
}

/**
 * How much later than the window's animation clock the visible window edge
 * moves. Transitions that follow the edge are delayed by this much; ~5ms was
 * the zero-crossing when sampling the controls against the viewport edge.
 */
export const WINDOW_EDGE_LATENCY_MS = 5;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Animates the native window while the page layout stays frozen at its
 * widest size. The window edge only clips or reveals already laid-out
 * content, so nothing reflows on every frame.
 */
export function useFrozenWindowResize() {
  const frozenWidth = ref<number | null>(null);
  const isResizing = ref(false);
  /** CSS transition-delay (ms, may be negative) aligning with the window. */
  const transitionDelay = ref(0);

  /** Returns false when the window was not resized (caller should fall back). */
  async function run(
    request: PineWindowResizeRequest,
    hooks: FrozenResizeHooks = {},
  ): Promise<boolean> {
    const pine = window.pine;
    if (isResizing.value || !pine?.planWindowResize) return false;
    isResizing.value = true;
    try {
      const delta = await pine.planWindowResize(request);
      if (delta === 0) return false;

      frozenWidth.value = window.innerWidth + Math.max(delta, 0);
      hooks.beforeCommit?.(delta);
      await nextTick();
      // Let the frozen layout paint before the window edge starts moving.
      await nextFrame();
      await nextFrame();

      const startCommit = (startedAt = Date.now()) => {
        transitionDelay.value =
          WINDOW_EDGE_LATENCY_MS - (Date.now() - startedAt);
        hooks.onCommitStart?.(delta);
      };
      const stopListening = pine.onWindowResizeStarted?.((startedAt) => {
        stopListening?.();
        startCommit(startedAt);
      });
      const committed = pine.commitWindowResize();
      if (!stopListening) startCommit();
      try {
        await committed;
      } finally {
        stopListening?.();
      }

      hooks.afterCommit?.();
      frozenWidth.value = null;
      await nextTick();
      // rAF callbacks run before style recalc, so flush styles explicitly:
      // otherwise callers re-enabling transitions right after this resolves
      // would animate the state change made in afterCommit.
      void document.body.offsetWidth;
      await nextFrame();
      await nextFrame();
      return true;
    } finally {
      frozenWidth.value = null;
      transitionDelay.value = 0;
      isResizing.value = false;
    }
  }

  return {
    frozenWidth: readonly(frozenWidth),
    isResizing: readonly(isResizing),
    transitionDelay: readonly(transitionDelay),
    run,
  };
}
