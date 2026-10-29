<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  WORKBENCH_DEFAULT_WIDTH,
  WORKBENCH_MAX_WIDTH,
  WORKBENCH_MIN_WIDTH,
} from "@/shared/workbench";
import { useWorkbenchStore } from "@/stores/workbench";

/** The conversation never narrows below this while the column widens. */
const MIN_CONVERSATION_WIDTH = 480;
const KEYBOARD_STEP = 16;

/**
 * The column's leading edge. Its line sits as far from the card as the card
 * sits from the window edge, over the conversation rather than in a gutter.
 * Dragging it trades width with the conversation inside a window that keeps
 * its size; double-clicking restores the default. A collapsed column sits
 * just past the window edge, so the handle hides rather than poke into view.
 */
const { t } = useI18n();
const workbench = useWorkbenchStore();
const isActive = computed(
  () => workbench.displayedOpen && !workbench.isClosing,
);
const handle = ref<HTMLElement>();
let drag: { startX: number; startWidth: number; maxWidth: number } | null =
  null;

/** The widest the column can get without squeezing the conversation. */
function maxWidth(): number {
  const inset = document.querySelector<HTMLElement>(
    "[data-slot=sidebar-inset]",
  );
  const room = inset
    ? workbench.width + inset.offsetWidth - MIN_CONVERSATION_WIDTH
    : WORKBENCH_MAX_WIDTH;
  return Math.max(WORKBENCH_MIN_WIDTH, Math.min(WORKBENCH_MAX_WIDTH, room));
}

function resizeTo(width: number, limit = maxWidth()): void {
  workbench.setWidth(Math.min(width, limit));
}

function start(event: PointerEvent): void {
  if (event.button !== 0 || !isActive.value) return;
  event.preventDefault();
  handle.value?.setPointerCapture(event.pointerId);
  drag = {
    startX: event.clientX,
    startWidth: workbench.width,
    maxWidth: maxWidth(),
  };
  workbench.setResizing(true);
}

function move(event: PointerEvent): void {
  if (!drag) return;
  // The column sits at the right, so moving left widens it.
  resizeTo(drag.startWidth + drag.startX - event.clientX, drag.maxWidth);
}

function stop(): void {
  if (!drag) return;
  drag = null;
  workbench.setResizing(false);
}

useEventListener(handle, "pointermove", move);
useEventListener(handle, "pointerup", stop);
useEventListener(handle, "pointercancel", stop);
useEventListener(handle, "lostpointercapture", stop);

function reset(): void {
  if (!isActive.value) return;
  resizeTo(WORKBENCH_DEFAULT_WIDTH);
  workbench.setResizing(false);
}

function nudge(event: KeyboardEvent): void {
  const step =
    event.key === "ArrowLeft"
      ? KEYBOARD_STEP
      : event.key === "ArrowRight"
        ? -KEYBOARD_STEP
        : 0;
  if (!step || !isActive.value) return;
  event.preventDefault();
  resizeTo(workbench.width + step);
  workbench.setResizing(false);
}
</script>

<template>
  <div
    v-show="isActive"
    ref="handle"
    role="separator"
    tabindex="0"
    aria-orientation="vertical"
    :aria-label="t('project.workbench.resize')"
    :aria-valuemin="WORKBENCH_MIN_WIDTH"
    :aria-valuemax="WORKBENCH_MAX_WIDTH"
    :aria-valuenow="workbench.width"
    data-testid="workbench-resize-handle"
    :data-resizing="workbench.isResizing || undefined"
    class="group/handle window-no-drag absolute top-[var(--window-titlebar-height)] bottom-0 -left-4.5 z-20 flex w-3 cursor-col-resize justify-center outline-none"
    @pointerdown="start"
    @dblclick="reset"
    @keydown="nudge"
  >
    <span
      aria-hidden="true"
      class="h-full w-px bg-transparent transition-colors duration-500 ease-out-expo group-hover/handle:bg-border group-focus-visible/handle:bg-ring group-data-resizing/handle:bg-border"
    />
  </div>
</template>
