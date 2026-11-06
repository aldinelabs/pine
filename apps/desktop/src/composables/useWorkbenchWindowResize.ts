import { useEventListener, useMediaQuery, useTimeoutFn } from "@vueuse/core";
import {
  computed,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { useWorkbenchStore } from "@/stores/workbench";

/** Lets the native resize settle before restoring column transitions. */
const RESIZE_SETTLE_MS = 150;

/**
 * Window resizing trades width with the workbench before the conversation.
 * Keep an anchor rather than accumulating clamped deltas: returning to the
 * original window width then restores the original layout even after a limit.
 * App-driven window animations and explicit divider drags rebase the anchor.
 */
export function useWorkbenchWindowResize(enabled: MaybeRefOrGetter<boolean>) {
  const workbench = useWorkbenchStore();
  // Match SidebarProvider: narrow screens use a sheet, not a second column.
  const isMobile = useMediaQuery("(max-width: 768px)");
  const active = computed(
    () =>
      toValue(enabled) &&
      !isMobile.value &&
      workbench.activeLayout.open &&
      workbench.displayedOpen &&
      !workbench.isClosing &&
      !workbench.isResizing,
  );
  const isResizing = ref(false);
  let anchor: { windowWidth: number; workbenchWidth: number } | null = null;
  let applyingWidth = false;
  let previousWindowWidth = window.innerWidth;

  const { start: settle, stop: cancelSettle } = useTimeoutFn(
    () => {
      isResizing.value = false;
      workbench.saveWidth();
    },
    RESIZE_SETTLE_MS,
    { immediate: false },
  );

  watch(
    () => [active.value, workbench.width] as const,
    () => {
      if (applyingWidth) return;
      if (!active.value) {
        cancelSettle();
        // Do not lose the last resized width if the user closes the column.
        if (isResizing.value) workbench.saveWidth();
        isResizing.value = false;
      }
      anchor = active.value
        ? { windowWidth: window.innerWidth, workbenchWidth: workbench.width }
        : null;
    },
    { immediate: true, flush: "sync" },
  );

  useEventListener(window, "resize", () => {
    const width = window.innerWidth;
    const changed = width !== previousWindowWidth;
    previousWindowWidth = width;
    if (!changed || !active.value || !anchor || width <= 768) return;
    isResizing.value = true;
    applyingWidth = true;
    try {
      workbench.setWidth(anchor.workbenchWidth + width - anchor.windowWidth);
    } finally {
      applyingWidth = false;
    }
    settle();
  });

  return { isResizing: readonly(isResizing) };
}
