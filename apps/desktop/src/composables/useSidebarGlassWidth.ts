import { useEventListener, useResizeObserver } from "@vueuse/core";
import {
  computed,
  onBeforeUnmount,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import { useAppearanceStore } from "@/stores/appearance";

/**
 * Reports how much of a sidebar shows, so the native glass under the page
 * covers exactly that strip. While the sidebar slides it reports every frame.
 */
export function useSidebarGlassWidth(
  root: MaybeRefOrGetter<HTMLElement | null | undefined>,
): void {
  const appearance = useAppearanceStore();
  const container = computed(() => {
    const element = toValue(root)?.querySelector(
      '[data-slot="sidebar-container"]',
    );
    return element instanceof HTMLElement ? element : undefined;
  });

  let sent: number | undefined;
  function send(width: number): void {
    if (width === sent) return;
    sent = width;
    window.pine?.setSidebarGlassWidth?.(width);
  }
  function report(): void {
    if (!appearance.sidebarVibrancy) return;
    // The sidebar is fixed to the window's left edge.
    const rect = container.value?.getBoundingClientRect();
    send(rect ? Math.max(0, rect.right) : 0);
  }

  let frame = 0;
  function follow(): void {
    report();
    frame = requestAnimationFrame(follow);
  }
  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    report();
  }
  useEventListener(container, "transitionrun", (event: TransitionEvent) => {
    if (event.target === container.value && !frame) follow();
  });
  for (const type of ["transitionend", "transitioncancel"])
    useEventListener(container, type, (event: Event) => {
      if (event.target === container.value) stop();
    });
  useResizeObserver(container, report);
  watch(
    () => appearance.sidebarVibrancy,
    () => {
      sent = undefined;
      report();
    },
  );

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame);
    send(0);
  });
}
