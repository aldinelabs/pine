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
import { prefersReducedMotion } from "@/lib/animateScroll";
import {
  advanceThinkingBlocks,
  type ThinkingBlockState,
} from "@/lib/thinkingBlocks";

/**
 * The thinking panel while the model is still thinking: a scroll area that
 * grows one whole Markdown block at a time. A block is added once the next
 * one starts (or its thinking segment ends), fades in, and the panel glides
 * to it with the browser's own smooth scroll, unless the reader has scrolled
 * up. Before the first block completes a one-line skeleton holds the panel's
 * starting height. Blocks are only ever appended, so the panel never shrinks.
 *
 * Each block renders once into its own Markdown view, so adding one costs
 * that block, not the thinking so far.
 *
 * Fallback for a block that takes long: once the block being written passes
 * `OVERDUE_CHARS` or has been written for `OVERDUE_MS`, it is shown as it
 * stands and refreshed at most every `PARTIAL_REFRESH_MS` (not per token).
 * Its completed text then replaces it in place.
 */
const props = defineProps<{
  /** The thinking content blocks with visible text, in order; the last streams. */
  sources: readonly { segment: number; text: string }[];
}>();

interface LiveItem {
  key: string;
  text: string;
  /** The whole block; false for an overdue block shown while written. */
  complete: boolean;
  /** Shown at mount: no enter animation. */
  initial: boolean;
}

/** An unfinished block this long is shown as it stands. */
const OVERDUE_CHARS = 600;
/** An unfinished block written for this long is shown as it stands. */
const OVERDUE_MS = 4000;
/** An overdue block's shown text is refreshed at most this often. */
const PARTIAL_REFRESH_MS = 1500;
/** Within this distance of the bottom the panel follows new blocks again. */
const FOLLOW_THRESHOLD_PX = 24;
/** Scroll position past which an edge counts as scrollable (fade shown). */
const FADE_EDGE_THRESHOLD = 1;

const root = useTemplateRef<HTMLElement>("root");
const body = useTemplateRef<HTMLElement>("body");
const items = shallowRef<LiveItem[]>([]);
const hasHiddenAbove = ref(false);
const hasHiddenBelow = ref(false);
const isFollowing = ref(true);

let split: ThinkingBlockState | undefined;
let splitSegment: number | undefined;
let splitText = "";
/** Offset in the streaming segment up to which whole blocks are shown. */
let shownEnd = 0;
/** Earlier segments already shown in full. */
const shownSegments = new Set<number>();
let isMounted = false;
/** When the block being written started (or its segment did). */
let blockSince = Date.now();
/** The overdue block last shown while written: its key, time and length. */
let partialKey: string | undefined;
let partialAt = 0;
let partialLength = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
/** Panel scroll range from the last resize report. */
let maxTop = 0;
/** The bottom the panel was last sent to, so a repeat report does nothing. */
let lastTarget: number | undefined;
let hasUserScrollIntent = false;

function show(key: string, text: string, complete: boolean): void {
  const list = items.value;
  const index = list.findIndex((item) => item.key === key);
  if (index >= 0) {
    const item = list[index];
    if (item.text === text && item.complete === complete) return;
    const next = list.slice();
    next[index] = { ...item, text, complete };
    items.value = next;
    return;
  }
  items.value = [
    ...list,
    // Text already complete at mount shows at once; later blocks fade in.
    { key, text, complete, initial: !isMounted },
  ];
}

/** One pending timer at most, so a stalled stream still reaches the fallback. */
function scheduleRecheck(delay: number): void {
  if (timer !== undefined) return;
  timer = setTimeout(
    () => {
      timer = undefined;
      update(props.sources);
    },
    Math.max(0, delay),
  );
}

function cancelRecheck(): void {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
}

/**
 * Shows the segment's text from where the last whole block ended up to
 * `end` as complete: one block normally, several at once when a flush
 * finished more than one (or the panel mounted mid-stream). An overdue
 * block shown while written is replaced in place.
 */
function showCompleted(end: number): void {
  if (!split || splitSegment === undefined) return;
  const text = splitText.slice(shownEnd, end).trim();
  if (text === "") return;
  const key = partialKey ?? `${splitSegment}:${split.blockIndex - 1}`;
  show(key, text, true);
  shownEnd = end;
  partialKey = undefined;
}

function finishSplitSegment(): void {
  if (splitSegment === undefined) return;
  if (split) {
    // The thinking content block ended: its last block is complete.
    const end = splitText.length;
    const text = splitText.slice(shownEnd, end).trim();
    if (text !== "")
      show(partialKey ?? `${splitSegment}:${split.blockIndex}`, text, true);
  }
  shownSegments.add(splitSegment);
}

function update(sources: readonly { segment: number; text: string }[]): void {
  const source = sources.at(-1);
  if (!source) return;
  // Earlier segments not yet shown (the panel mounted mid-stream) show whole.
  for (const earlier of sources.slice(0, -1)) {
    if (shownSegments.has(earlier.segment) || earlier.segment === splitSegment)
      continue;
    const text = earlier.text.trim();
    if (text !== "") show(`${earlier.segment}:all`, text, true);
    shownSegments.add(earlier.segment);
  }
  if (source.segment !== splitSegment) {
    finishSplitSegment();
    split = undefined;
    splitSegment = source.segment;
    shownEnd = 0;
    partialKey = undefined;
    blockSince = Date.now();
    cancelRecheck();
  }
  // A rewrite shorter than what is shown starts the segment's text over.
  if (source.text.length < shownEnd) shownEnd = 0;
  const previousIndex = split?.blockIndex ?? 0;
  split = advanceThinkingBlocks(split, source.text);
  splitText = source.text;
  if (split.blockIndex !== previousIndex) {
    showCompleted(split.blockStart);
    blockSince = Date.now();
    cancelRecheck();
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
  const text = source.text.slice(shownEnd).trim();
  if (text === "") return;
  partialKey = key;
  partialAt = now;
  partialLength = source.text.length;
  show(key, text, false);
}

watch(() => props.sources, update, { immediate: true });

function updateEdges(scrollTop: number): void {
  const above = scrollTop > FADE_EDGE_THRESHOLD;
  const below = maxTop - scrollTop > FADE_EDGE_THRESHOLD;
  if (hasHiddenAbove.value !== above) hasHiddenAbove.value = above;
  if (hasHiddenBelow.value !== below) hasHiddenBelow.value = below;
}

function scrollToBottom(element: HTMLElement, smooth: boolean): void {
  if (maxTop === lastTarget) return;
  lastTarget = maxTop;
  if (typeof element.scrollTo !== "function") return;
  element.scrollTo({
    top: maxTop,
    behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
  });
}

/**
 * Runs after layout whenever a block is added or reflows, so the
 * measurements here force no extra layout. While following, the panel
 * glides to the newest block with the browser's smooth scroll, which runs
 * off the main thread and retargets itself if another block lands mid-glide.
 */
function handleResize(): void {
  const element = root.value;
  if (!element) return;
  maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  updateEdges(element.scrollTop);
  if (isFollowing.value) scrollToBottom(element, true);
}

function handleScroll(): void {
  const element = root.value;
  if (!element) return;
  const scrollTop = element.scrollTop;
  updateEdges(scrollTop);
  if (maxTop - scrollTop <= FOLLOW_THRESHOLD_PX) {
    isFollowing.value = true;
    hasUserScrollIntent = false;
    return;
  }
  // Only the reader's own scroll stops following, not the glide itself.
  if (hasUserScrollIntent) {
    isFollowing.value = false;
    lastTarget = undefined;
  }
  hasUserScrollIntent = false;
}

function markUserScrollIntent(): void {
  hasUserScrollIntent = true;
}

onMounted(() => {
  isMounted = true;
  const element = root.value;
  if (element) {
    // Whatever was complete at mount is pinned at its end without a glide.
    maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    scrollToBottom(element, false);
  }
  if (typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(handleResize);
  if (body.value) observer.observe(body.value);
});

onBeforeUnmount(() => {
  cancelRecheck();
  observer?.disconnect();
  observer = undefined;
});

const scrollableAttr = computed(() => {
  // While following, the glide trails the newest block: no bottom fade
  // pulsing on each landing.
  const edges = [
    hasHiddenAbove.value && "start",
    hasHiddenBelow.value && !isFollowing.value && "end",
  ].filter(Boolean);
  return edges.length > 0 ? edges.join(" ") : undefined;
});
</script>

<template>
  <div
    ref="root"
    data-thinking-live
    class="thinking-scroll-fade no-scrollbar mt-3 max-h-64 overflow-y-auto overscroll-contain pl-6 pr-3 text-sm text-muted-foreground"
    :data-scrollable="scrollableAttr"
    :data-following="isFollowing || undefined"
    @scroll.passive="handleScroll"
    @wheel.passive="markUserScrollIntent"
    @touchstart.passive="markUserScrollIntent"
    @pointerdown="markUserScrollIntent"
    @keydown="markUserScrollIntent"
  >
    <!-- The gap matches the compact Markdown paragraph spacing, so the
         finished panel's single render lines up with these blocks. -->
    <div ref="body" class="flex flex-col gap-1.5">
      <div
        v-if="items.length === 0"
        data-thinking-placeholder
        class="flex h-5 items-center"
        aria-hidden="true"
      >
        <Skeleton class="h-3 w-2/3 rounded-full motion-reduce:animate-none" />
      </div>
      <div
        v-for="item in items"
        :key="item.key"
        class="thinking-live-block"
        :data-initial="item.initial || undefined"
      >
        <MarkdownContent :source="item.text" :final="item.complete" compact />
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Opacity and transform only, so a new block's entrance runs on the
 * compositor: adding one costs one render of that block and no per-frame
 * script.
 */
.thinking-live-block {
  animation: thinking-block-in 320ms var(--ease-out-expo) both;
}

.thinking-live-block[data-initial] {
  animation: none;
}

@keyframes thinking-block-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
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

.thinking-scroll-fade[data-scrollable~="end"] {
  --scroll-fade-b: var(--_fade-size);
}

@media (prefers-reduced-motion: reduce) {
  .thinking-live-block {
    animation: none;
  }

  .thinking-scroll-fade {
    transition: none;
  }
}
</style>
