<script setup lang="ts">
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import { useI18n } from "vue-i18n";
import { Sidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  WORKBENCH_MAX_SPLIT,
  WORKBENCH_MIN_SPLIT,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchCard from "./WorkbenchCard.vue";
import WorkbenchResizeHandle from "./WorkbenchResizeHandle.vue";

/** Matches the cards' `duration-500 ease-out-expo` grow transition. */
const CARD_TRANSITION_MS = 500;
const CARD_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const SPLIT_KEYBOARD_STEP = 5;
/** Flex `order` of the stack's items; the divider sits between the cards. */
const ORDER = {
  closingTop: 0,
  top: 10,
  divider: 20,
  bottom: 30,
  closingBottom: 40,
};

/**
 * A card in the stack. A card follows its panel rather than its position, so
 * closing the top card shrinks it away while the card below grows up into its
 * place, and its content never remounts.
 */
interface StackCard {
  id: number;
  panel: WorkbenchPanel;
  position: WorkbenchPosition;
  order: number;
  entering: boolean;
  closing: boolean;
}

/**
 * The column beside the conversation. Its cards are flex items whose `order`
 * places them and whose `flex-grow` sizes them, so adding, closing, and
 * resizing cards animates without moving any card's DOM.
 */
const { t } = useI18n();
const workbench = useWorkbenchStore();
const layout = computed(() => workbench.activeLayout);
const stack = useTemplateRef<HTMLElement>("stack");
const divider = useTemplateRef<HTMLElement>("divider");
const elements = new Map<number, HTMLElement>();
const cards = ref<StackCard[]>([]);
const isDragging = ref(false);
/** Skips the grow transition, as when switching sessions. */
const isInstant = ref(true);
let nextId = 0;
const timers = new Set<ReturnType<typeof setTimeout>>();

function afterPaint(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

function setElement(
  id: number,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLElement) elements.set(id, element);
  else elements.delete(id);
}

interface Snapshot {
  id: number;
  position: WorkbenchPosition;
  top: number;
  height: number;
}

/** Where the settled cards sit now, relative to the stack. */
function snapshot(): Snapshot[] {
  const origin = stack.value?.getBoundingClientRect().top ?? 0;
  return cards.value.flatMap((card) => {
    const element = elements.get(card.id);
    if (card.closing || card.entering || !element) return [];
    const rect = element.getBoundingClientRect();
    return [
      {
        id: card.id,
        position: card.position,
        top: rect.top - origin,
        height: rect.height,
      },
    ];
  });
}

/**
 * Two cards traded places. Their `order` flips at once, so each card starts
 * where it was, with its old height, and slides to its new place while the
 * heights trade: the flex bases keep the column filled, and a translate
 * offsets each card from where those bases lay it out.
 */
function animateSwap(before: Snapshot[]): void {
  const height = stack.value?.getBoundingClientRect().height ?? 0;
  const gap = divider.value?.getBoundingClientRect().height ?? 0;
  const available = height - gap;
  if (available <= 0) return;
  const { split } = layout.value;
  const newTop = before.find((card) => card.position === "bottom")!;
  for (const card of before) {
    const element = elements.get(card.id);
    if (typeof element?.animate !== "function") continue;
    const movesUp = card === newTop;
    const laidOutAt = movesUp ? 0 : newTop.height + gap;
    const settledHeight = ((movesUp ? split : 100 - split) / 100) * available;
    element.animate(
      [
        {
          flexGrow: 0,
          flexBasis: `${card.height}px`,
          transform: `translateY(${card.top - laidOutAt}px)`,
        },
        {
          flexGrow: 0,
          flexBasis: `${settledHeight}px`,
          transform: "translateY(0)",
        },
      ],
      { duration: CARD_TRANSITION_MS, easing: CARD_EASING },
    );
  }
}

function reconcile(animate: boolean): void {
  const before = animate ? snapshot() : [];
  const { top, bottom } = layout.value;
  const shown = (panel: WorkbenchPanel) => panel === top || panel === bottom;
  const placed = new Set<number>();
  for (const [position, panel] of [
    ["top", top],
    ["bottom", bottom],
  ] as const) {
    if (!panel) continue;
    // The card already showing this panel, even one still closing; else the
    // card at this position whose panel is leaving swaps its content.
    let card =
      cards.value.find(
        (item) => item.panel === panel && !placed.has(item.id),
      ) ??
      cards.value.find(
        (item) =>
          item.position === position &&
          !placed.has(item.id) &&
          !shown(item.panel),
      );
    if (!card) {
      card = {
        id: nextId++,
        panel,
        position,
        order: ORDER[position],
        entering: animate,
        closing: false,
      };
      cards.value.push(card);
    }
    card.panel = panel;
    card.position = position;
    card.order = ORDER[position];
    card.closing = false;
    placed.add(card.id);
  }
  for (const card of cards.value) {
    if (placed.has(card.id) || card.closing) continue;
    card.order =
      card.position === "top" ? ORDER.closingTop : ORDER.closingBottom;
    card.closing = true;
    card.entering = false;
  }
  if (!animate) {
    cards.value = cards.value.filter((card) => !card.closing);
    return;
  }
  const swapped =
    before.length === 2 &&
    before.every((previous) => {
      const card = cards.value.find((item) => item.id === previous.id);
      return card && !card.closing && card.position !== previous.position;
    });
  if (swapped) void nextTick(() => animateSwap(before));
  if (cards.value.some((card) => card.entering))
    afterPaint(() => {
      for (const card of cards.value) card.entering = false;
    });
  if (cards.value.some((card) => card.closing)) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      cards.value = cards.value.filter((card) => !card.closing);
    }, CARD_TRANSITION_MS);
    timers.add(timer);
  }
}

function settle(): void {
  isInstant.value = true;
  reconcile(false);
  afterPaint(() => {
    isInstant.value = false;
  });
}

settle();
// Another session's workbench replaces this one rather than animating to it.
watch(() => workbench.activeKey, settle);
watch(
  () => [layout.value.top, layout.value.bottom] as const,
  () => reconcile(!isInstant.value),
);

onUnmounted(() => {
  for (const timer of timers) clearTimeout(timer);
});

const liveCount = computed(
  () => cards.value.filter((card) => !card.closing && !card.entering).length,
);

function growOf(card: StackCard): number {
  if (card.closing || card.entering) return 0;
  if (liveCount.value < 2) return 100;
  const { split } = layout.value;
  return card.position === "top" ? split : 100 - split;
}

const transitionClass = computed(() =>
  isDragging.value || isInstant.value
    ? ""
    : "transition-[flex-grow,height] duration-500 ease-out-expo",
);

let dragStart: { y: number; split: number; height: number } | null = null;

function startDrag(event: PointerEvent): void {
  if (event.button !== 0 || !stack.value) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragStart = {
    y: event.clientY,
    split: layout.value.split,
    height: stack.value.getBoundingClientRect().height,
  };
  isDragging.value = true;
}

function drag(event: PointerEvent): void {
  if (!dragStart || dragStart.height <= 0) return;
  const delta = ((event.clientY - dragStart.y) / dragStart.height) * 100;
  workbench.setSplit(dragStart.split + delta);
}

function endDrag(): void {
  dragStart = null;
  isDragging.value = false;
}

function resizeWithKeyboard(event: KeyboardEvent): void {
  const { split } = layout.value;
  const next = {
    ArrowUp: split - SPLIT_KEYBOARD_STEP,
    ArrowDown: split + SPLIT_KEYBOARD_STEP,
    Home: WORKBENCH_MIN_SPLIT,
    End: WORKBENCH_MAX_SPLIT,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  workbench.setSplit(next);
}
</script>

<template>
  <!-- The column extends the main area: same background, no divider.
       The resize handle overlays the conversation, so it takes no width. -->
  <Sidebar
    side="right"
    collapsible="offcanvas"
    data-testid="project-workbench"
    data-workbench
    class="group-data-[side=right]:border-l-0 [&>[data-slot=sidebar-inner]]:bg-background"
  >
    <WorkbenchResizeHandle />
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <div class="flex min-h-0 flex-1 flex-col pr-3 pb-3">
      <div
        ref="stack"
        class="flex min-h-0 flex-1 flex-col"
        :class="isDragging && 'cursor-row-resize select-none'"
      >
        <div
          v-for="card in cards"
          :key="card.id"
          :ref="(element) => setElement(card.id, element)"
          data-testid="workbench-stack-item"
          :class="cn('min-h-0 basis-0 overflow-hidden', transitionClass)"
          :style="{ order: card.order, flexGrow: growOf(card) }"
          :inert="card.closing || undefined"
        >
          <WorkbenchCard :panel="card.panel" :position="card.position" />
        </div>
        <div
          ref="divider"
          data-testid="workbench-divider"
          role="separator"
          aria-orientation="horizontal"
          :aria-label="t('project.workbench.resizeCards')"
          :aria-valuenow="layout.split"
          :aria-valuemin="WORKBENCH_MIN_SPLIT"
          :aria-valuemax="WORKBENCH_MAX_SPLIT"
          :tabindex="liveCount === 2 ? 0 : -1"
          :class="
            cn(
              'focus-visible:bg-ring/30 shrink-0 cursor-row-resize touch-none rounded-full outline-none',
              liveCount === 2 ? 'h-3' : 'pointer-events-none h-0',
              transitionClass,
            )
          "
          :style="{ order: ORDER.divider }"
          @pointerdown="startDrag"
          @pointermove="drag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @lostpointercapture="endDrag"
          @keydown="resizeWithKeyboard"
        />
      </div>
    </div>
  </Sidebar>
</template>
