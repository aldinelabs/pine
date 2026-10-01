import { nextTick, readonly, ref } from "vue";
import type { PineWindowResizeRequest } from "@/shared/window";

interface FrozenResizeHooks {
  /** Runs while frozen, before the window starts moving. */
  beforeCommit?: (delta: number) => void;
  /** Runs as the window animation starts; start matching CSS transitions here. */
  onCommitStart?: (delta: number) => void;
  /** Runs in the same tick as the unfreeze, so both land in one layout. */
  afterCommit?: () => void;
}

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

      const committed = pine.commitWindowResize();
      hooks.onCommitStart?.(delta);
      await committed;

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
      isResizing.value = false;
    }
  }

  return {
    frozenWidth: readonly(frozenWidth),
    isResizing: readonly(isResizing),
    run,
  };
}
