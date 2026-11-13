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
import { Skeleton } from "@/components/ui/skeleton";
import {
  advanceThinkingBlocks,
  completedThinkingBlock,
  currentThinkingBlock,
  type ThinkingBlockState,
} from "@/lib/thinkingBlocks";

/**
 * The thinking panel while the model is still thinking: one whole Markdown
 * block at a time, shown once the next block starts and crossfading to the
 * next completed one. Before the first block completes a one-line skeleton
 * holds the panel's starting height. It is not a scroll container and never
 * shrinks while mounted, so the transcript following the stream only ever
 * sees it grow.
 *
 * Fallback for a block that takes long: once the block being written passes
 * `OVERDUE_CHARS` or has been written for `OVERDUE_MS`, it is shown as it
 * stands and refreshed at most every
 * `PARTIAL_REFRESH_MS` (not per token). Its completed text then replaces it
 * in place.
 */
const props = defineProps<{
  /** The newest thinking content block with visible text. */
  source: { segment: number; text: string };
}>();

interface LiveItem {
  key: string;
  text: string;
  /** The whole block; false for an overdue block shown while written. */
  complete: boolean;
  leaving: boolean;
  tall: boolean;
  initial: boolean;
}

/** Fallback for the panel's `max-h-64` when no computed style is available. */
const DEFAULT_CAP_PX = 256;
/** An unfinished block this long is shown as it stands. */
const OVERDUE_CHARS = 600;
/** An unfinished block written for this long is shown as it stands. */
const OVERDUE_MS = 4000;
/** An overdue block's shown text is refreshed at most this often. */
const PARTIAL_REFRESH_MS = 1500;

const root = useTemplateRef<HTMLElement>("root");
const stack = useTemplateRef<HTMLElement>("stack");
const items = shallowRef<LiveItem[]>([]);
const minHeight = ref(0);
let capPx = DEFAULT_CAP_PX;
let split: ThinkingBlockState | undefined;
let splitSegment: number | undefined;
let splitText = "";
let observer: ResizeObserver | undefined;
let observedItem: Element | undefined;
let isMounted = false;
/** When the block being written started (or its segment did). */
let blockSince = Date.now();
/** The overdue block last shown while written: its key, time and length. */
let partialKey: string | undefined;
let partialAt = 0;
let partialLength = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const current = computed(() => items.value.at(-1));
const currentKey = computed(() => current.value?.key);
const isClipped = computed(() => current.value?.tall === true);
/** A tall block, current or fading out, is shown by its tail: keep the top fade. */
const showsTail = computed(() => items.value.some((item) => item.tall));

function show(key: string, text: string, complete: boolean): void {
  const last = items.value.at(-1);
  if (last?.key === key) {
    if (last.text === text && last.complete === complete) return;
    items.value = [...items.value.slice(0, -1), { ...last, text, complete }];
    return;
  }
  const next: LiveItem = {
    key,
    text,
    complete,
    leaving: false,
    tall: false,
    // Already-complete text at mount shows at once; after the skeleton it fades in.
    initial: !last && !isMounted,
  };
  items.value = last ? [{ ...last, leaving: true }, next] : [next];
}

/** One pending timer at most, so a stalled stream still reaches the fallback. */
function scheduleRecheck(delay: number): void {
  if (timer !== undefined) return;
  timer = setTimeout(
    () => {
      timer = undefined;
      update(props.source);
    },
    Math.max(0, delay),
  );
}

function cancelRecheck(): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
}

function update(source: { segment: number; text: string }): void {
  if (source.segment !== splitSegment) {
    // The previous thinking content block ended: its last block is complete.
    if (split && splitSegment !== undefined) {
      const tail = currentThinkingBlock(split, splitText);
      if (tail !== "") show(`${splitSegment}:${split.blockIndex}`, tail, true);
    }
    split = undefined;
    splitSegment = source.segment;
    blockSince = Date.now();
    cancelRecheck();
  }
  const previousIndex = split?.blockIndex;
  split = advanceThinkingBlocks(split, source.text);
  splitText = source.text;
  if (previousIndex === undefined || split.blockIndex !== previousIndex) {
    const completed = completedThinkingBlock(split, source.text);
    if (completed !== "")
      show(`${source.segment}:${split.blockIndex - 1}`, completed, true);
    if (previousIndex !== undefined) {
      blockSince = Date.now();
      cancelRecheck();
    }
  }

  const written = source.text.length - split.blockStart;
  const now = Date.now();
  if (written <= OVERDUE_CHARS && now - blockSince < OVERDUE_MS) {
    scheduleRecheck(blockSince + OVERDUE_MS - now);
    return;
  }
  const key = `${source.segment}:${split.blockIndex}`;
  if (partialKey === key) {
    if (source.text.length === partialLength) return;
    if (now - partialAt < PARTIAL_REFRESH_MS) {
      scheduleRecheck(partialAt + PARTIAL_REFRESH_MS - now);
      return;
    }
  }
  const text = currentThinkingBlock(split, source.text);
  if (text === "") return;
  partialKey = key;
  partialAt = now;
  partialLength = source.text.length;
  show(key, text, false);
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
  isMounted = true;
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
  cancelRecheck();
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
        v-if="items.length === 0"
        data-thinking-placeholder
        class="flex h-5 items-center [grid-area:1/1]"
        aria-hidden="true"
      >
        <Skeleton class="h-3 w-2/3 rounded-full motion-reduce:animate-none" />
      </div>
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
        <MarkdownContent
          :source="item.text"
          :final="item.complete || item.leaving"
          compact
        />
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
