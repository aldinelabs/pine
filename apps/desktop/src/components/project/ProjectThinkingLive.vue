<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import {
  advanceThinkingBlocks,
  currentThinkingBlock,
  type ThinkingBlockState,
} from "@/lib/thinkingBlocks";

/**
 * The thinking panel while the model is still thinking: only the Markdown
 * block being written, crossfading to the next one when it starts. It is not
 * a scroll container and never shrinks while mounted, so the transcript
 * following the stream only ever sees it grow.
 */
const props = defineProps<{
  /** The newest thinking content block with visible text. */
  source: { segment: number; text: string };
}>();

interface LiveItem {
  key: string;
  text: string;
  leaving: boolean;
  tall: boolean;
  initial: boolean;
}

/** Fallback for the panel's `max-h-64` when no computed style is available. */
const DEFAULT_CAP_PX = 256;

const root = useTemplateRef<HTMLElement>("root");
const stack = useTemplateRef<HTMLElement>("stack");
const items = shallowRef<LiveItem[]>([]);
const minHeight = ref(0);
let capPx = DEFAULT_CAP_PX;
let split: ThinkingBlockState | undefined;
let splitSegment: number | undefined;
let observer: ResizeObserver | undefined;
let observedItem: Element | undefined;

const current = computed(() => items.value.at(-1));
const currentKey = computed(() => current.value?.key);
const isClipped = computed(() => current.value?.tall === true);
/** A tall block, current or fading out, is shown by its tail: keep the top fade. */
const showsTail = computed(() => items.value.some((item) => item.tall));

function update(source: { segment: number; text: string }): void {
  if (source.segment !== splitSegment) {
    // A new thinking content block is always a new block.
    split = undefined;
    splitSegment = source.segment;
  }
  const previousStart = split?.blockStart;
  const previousIndex = split?.blockIndex;
  split = advanceThinkingBlocks(split, source.text);
  const text = currentThinkingBlock(split, source.text);
  // Never fade to an empty block: keep the last one until text arrives.
  if (text === "") return;
  const key = `${source.segment}:${split.blockIndex}`;
  const last = items.value.at(-1);
  if (last?.key === key) {
    if (last.text === text) return;
    items.value = [...items.value.slice(0, -1), { ...last, text }];
    return;
  }
  if (!last) {
    items.value = [{ key, text, leaving: false, tall: false, initial: true }];
    return;
  }
  // Freeze the outgoing block at what it held when the next one began.
  const leavingText =
    previousStart !== undefined &&
    previousIndex === split.blockIndex - 1 &&
    last.key === `${source.segment}:${previousIndex}`
      ? source.text.slice(previousStart, split.blockStart).trim()
      : last.text;
  items.value = [
    { ...last, text: leavingText || last.text, leaving: true },
    { key, text, leaving: false, tall: false, initial: false },
  ];
}

watch(() => props.source, update, { immediate: true });

function dropLeaving(key: string): void {
  const next = items.value.filter(
    (item) => !(item.leaving && item.key === key),
  );
  if (next.length !== items.value.length) items.value = next;
}

function handleAnimationEnd(item: LiveItem): void {
  if (item.leaving) dropLeaving(item.key);
}

function entryHeight(entry: ResizeObserverEntry): number {
  return entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
}

/**
 * Runs after layout, reading sizes the browser already computed: the panel
 * keeps the tallest height it has shown (up to its cap), and a block taller
 * than the cap aligns to the bottom so the newest line stays in view.
 */
function handleResize(entries: ResizeObserverEntry[]): void {
  for (const entry of entries) {
    const height = entryHeight(entry);
    if (entry.target === stack.value) {
      const capped = Math.min(height, capPx);
      if (capped > minHeight.value) minHeight.value = capped;
      continue;
    }
    const item = current.value;
    if (entry.target === observedItem && item && !item.tall && height > capPx) {
      items.value = [...items.value.slice(0, -1), { ...item, tall: true }];
    }
  }
}

function observeCurrentItem(): void {
  if (!observer) return;
  const element = stack.value?.lastElementChild ?? undefined;
  if (element === observedItem) return;
  if (observedItem) observer.unobserve(observedItem);
  observedItem = element;
  if (element) observer.observe(element);
}

watch(currentKey, observeCurrentItem, { flush: "post" });

onMounted(() => {
  const element = root.value;
  if (element) {
    const max = Number.parseFloat(getComputedStyle(element).maxHeight);
    if (Number.isFinite(max) && max > 0) capPx = max;
  }
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(handleResize);
  if (stack.value) observer.observe(stack.value);
  observeCurrentItem();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = undefined;
  observedItem = undefined;
});
</script>

<template>
  <div
    ref="root"
    data-thinking-live
    class="thinking-scroll-fade relative mt-3 flex max-h-64 flex-col overflow-hidden pl-6 pr-3 text-sm text-muted-foreground"
    :class="isClipped && 'justify-end'"
    :data-scrollable="showsTail ? 'start' : undefined"
    :style="minHeight ? { minHeight: `${minHeight}px` } : undefined"
  >
    <div ref="stack" class="grid shrink-0">
      <div
        v-for="item in items"
        :key="item.key"
        class="thinking-live-block [grid-area:1/1]"
        :data-leaving="item.leaving || undefined"
        :data-tall="item.tall || undefined"
        :data-initial="item.initial || undefined"
        :aria-hidden="item.leaving || undefined"
        @animationend.self="handleAnimationEnd(item)"
      >
        <MarkdownContent :source="item.text" :final="item.leaving" compact />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Opacity-only keyframes run on the compositor: a swap costs one render of
 * the new block and no per-frame script. The incoming block fades in while
 * the outgoing one fades out in the same grid cell, so nothing shifts.
 */
.thinking-live-block {
  align-self: start;
  animation: thinking-block-in 240ms var(--ease-out-expo) both;
}

.thinking-live-block[data-tall] {
  align-self: end;
}

/*
 * A tall block that starts fading out leaves the stack's layout and stays
 * pinned to the panel bottom, where it was shown, so the next (short) block
 * can align to the top without the outgoing tail jumping. The padding
 * matches the root's `pl-6 pr-3`.
 */
.thinking-live-block[data-leaving][data-tall] {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  padding-left: calc(var(--spacing) * 6);
  padding-right: calc(var(--spacing) * 3);
}

.thinking-live-block[data-initial] {
  animation: none;
}

.thinking-live-block[data-leaving] {
  animation: thinking-block-out 200ms ease-out both;
  pointer-events: none;
}

@keyframes thinking-block-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes thinking-block-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* Same edge fade as the finished panel (`ProjectThinkingMarker.vue`). */
.thinking-scroll-fade {
  --_fade-size: min(12%, calc(var(--spacing) * 10));
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-t, 0px),
    #000 calc(100% - var(--scroll-fade-b, 0px)),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 var(--scroll-fade-t, 0px),
    #000 calc(100% - var(--scroll-fade-b, 0px)),
    transparent 100%
  );
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  transition:
    --scroll-fade-t 200ms ease-out,
    --scroll-fade-b 200ms ease-out;
}

.thinking-scroll-fade[data-scrollable~="start"] {
  --scroll-fade-t: var(--_fade-size);
}

@media (prefers-reduced-motion: reduce) {
  .thinking-live-block {
    animation: none;
  }

  .thinking-live-block[data-leaving] {
    display: none;
  }

  .thinking-scroll-fade {
    transition: none;
  }
}
</style>
