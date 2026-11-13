<script setup lang="ts">
import { useFlipFollowScroll } from "@/composables/useFlipFollowScroll";
import { useMountedWhileOpen } from "@/composables/useMountedWhileOpen";
import { ChevronRightIcon } from "@lucide/vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  advanceThinkingSegment,
  thinkingSegmentBlock,
  type ThinkingSegmentSplit,
} from "@/lib/thinkingBlocks";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { useOptionalMessageScrollerContext } from "@/components/ui/message-scroller/useMessageScroller";
import type { PineTranscriptMessage } from "@/stores/session";

const props = withDefaults(
  defineProps<{
    message: PineTranscriptMessage;
    /** Only output after this run should collapse it; earlier text must not. */
    hasResponseAfterThinking?: boolean;
    /** Reserve the hand-over only for body text, not a following tool run. */
    hasTextAfterThinking?: boolean;
  }>(),
  { hasResponseAfterThinking: undefined, hasTextAfterThinking: undefined },
);
const { locale, t } = useI18n();
const contentId = useId();
const thinkingContent = useTemplateRef<HTMLElement>("thinkingContent");
const thinkingBody = useTemplateRef<HTMLElement>("thinkingBody");
const scroller = useOptionalMessageScrollerContext();
const isExpanded = ref(false);
/** Matches the 500ms grid-rows collapse transition below. */
const isContentMounted = useMountedWhileOpen(isExpanded, 500);
const isFollowingThinking = ref(true);
const hasThinkingUserScrollIntent = ref(false);
const now = ref(Date.now());
let elapsedTimer: number | undefined;
/** Panel scroll range, measured after layout by the resize observer. */
let panelMetrics: { range: number } | undefined;
/** The bottom the panel was last sent to, so a repeat report does nothing. */
let lastPinTarget: number | undefined;
/** The panel was just opened: its next size report glides it to the bottom. */
let pendingOpenPin = false;
/** Glides the body on the compositor; the panel scrolls once per update. */
const follow = useFlipFollowScroll({
  scroller: () => thinkingContent.value,
  content: () => thinkingBody.value,
});
let bodyObserver: ResizeObserver | undefined;
/** Scroll position past which an edge counts as scrollable (fade shown). */
const FADE_EDGE_THRESHOLD = 1;
const hasHiddenContentAbove = ref(false);
const hasHiddenContentBelow = ref(false);
/** Whether the panel has any scroll range at all. */
const isPanelScrollable = ref(false);

const isStreaming = computed(
  () => props.message.thinkingStatus === "streaming",
);

/** One string per thinking content block; nothing is joined per flush. */
const thinkingSegments = computed<readonly string[]>(() => {
  const segments: string[] = [];
  for (const block of props.message.blocks)
    if (block.type === "thinking") segments.push(block.thinking);
  return segments;
});

function sameSegments(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

/** Streaming thinking reaches the panel at most this often. */
const THINKING_UPDATE_INTERVAL_MS = 250;

/**
 * The thinking the panel renders. While thinking streams it follows
 * `thinkingSegments` at most every `THINKING_UPDATE_INTERVAL_MS`: the first
 * change after a quiet interval shows at once, later ones wait for one
 * pending timer, so a fast stream re-renders the Markdown and moves the
 * panel four times a second rather than on every flush. Anything else
 * (thinking finished, another message) shows at once.
 */
const shownSegments = shallowRef<readonly string[]>(thinkingSegments.value);
/** The finished view renders every segment in one piece. */
const shownThinkingText = computed(() => shownSegments.value.join("\n"));
let lastThinkingUpdateAt = 0;
let thinkingUpdateTimer: ReturnType<typeof setTimeout> | undefined;

function cancelThinkingUpdate(): void {
  if (thinkingUpdateTimer === undefined) return;
  clearTimeout(thinkingUpdateTimer);
  thinkingUpdateTimer = undefined;
}

function showThinkingText(): void {
  cancelThinkingUpdate();
  lastThinkingUpdateAt = Date.now();
  if (!sameSegments(shownSegments.value, thinkingSegments.value))
    shownSegments.value = thinkingSegments.value;
}

watch(thinkingSegments, () => {
  if (!isStreaming.value) {
    showThinkingText();
    return;
  }
  if (thinkingUpdateTimer !== undefined) return;
  const wait = lastThinkingUpdateAt + THINKING_UPDATE_INTERVAL_MS - Date.now();
  if (wait <= 0) {
    showThinkingText();
    return;
  }
  thinkingUpdateTimer = setTimeout(() => {
    thinkingUpdateTimer = undefined;
    showThinkingText();
  }, wait);
});

watch(isStreaming, (streaming) => {
  if (!streaming) showThinkingText();
});

interface ThinkingBlockItem {
  key: string;
  source: string;
  final: boolean;
}

/**
 * While the panel is open on streaming thinking, each segment is split into
 * Markdown blocks and each block renders on its own: completed blocks render
 * once and are never touched again, so an update re-renders only the block
 * being written. The view stays in blocks for this message until the panel
 * unmounts, so finishing re-lays nothing out; a later mount of finished
 * thinking renders it in one piece.
 */
const useBlockView = ref(false);
const blockItems = shallowRef<readonly ThinkingBlockItem[]>([]);
/** Per-segment split state and the items built from it (not reactive). */
let segmentSplits: (ThinkingSegmentSplit | undefined)[] = [];
let segmentItems: ThinkingBlockItem[][] = [];
/** The text and tail state each segment's items were built from. */
let segmentBuilds: { text: string; tailFinal: boolean }[] = [];

function resetBlockView(): void {
  useBlockView.value = false;
  blockItems.value = [];
  segmentSplits = [];
  segmentItems = [];
  segmentBuilds = [];
}

function startBlockView(): void {
  if (useBlockView.value) return;
  useBlockView.value = true;
  rebuildBlocks();
}

/** Items for one segment, reusing the completed ones already built. */
function segmentBlockItems(
  segmentIndex: number,
  text: string,
  isLast: boolean,
): ThinkingBlockItem[] {
  const tailFinal = !isLast || !isStreaming.value;
  const built = segmentBuilds[segmentIndex];
  const cached = segmentItems[segmentIndex];
  // An earlier segment no longer changes: nothing to scan or slice.
  if (cached && built?.text === text && built.tailFinal === tailFinal)
    return cached;
  segmentBuilds[segmentIndex] = { text, tailFinal };
  const previous = segmentSplits[segmentIndex];
  const split = advanceThinkingSegment(previous, text);
  segmentSplits[segmentIndex] = split;
  const items =
    previous && split.starts === previous.starts
      ? (segmentItems[segmentIndex] ?? [])
      : [];
  segmentItems[segmentIndex] = items;
  const last = split.starts.length - 1;
  for (let index = 0; index <= last; index++) {
    const existing = items[index];
    const complete = !isLast || index < last;
    // Completed blocks keep their item, so their render is skipped.
    if (existing?.final && complete && index < items.length - 1) continue;
    const final = complete || tailFinal;
    const source = thinkingSegmentBlock(split, text, index);
    if (existing && existing.source === source && existing.final === final)
      continue;
    items[index] = {
      key: `${segmentIndex}:${index}`,
      source,
      final,
    };
  }
  items.length = last + 1;
  return items;
}

function rebuildBlocks(): void {
  if (!useBlockView.value) return;
  const segments = shownSegments.value;
  segmentSplits.length = Math.min(segmentSplits.length, segments.length);
  segmentItems.length = Math.min(segmentItems.length, segments.length);
  segmentBuilds.length = Math.min(segmentBuilds.length, segments.length);
  const next: ThinkingBlockItem[] = [];
  segments.forEach((text, segmentIndex) => {
    for (const item of segmentBlockItems(
      segmentIndex,
      text,
      segmentIndex === segments.length - 1,
    ))
      if (item.source) next.push(item);
  });
  blockItems.value = next;
}

watch([shownSegments, isStreaming], rebuildBlocks);

/** Which neighbouring renders block `index` continues the flow of. */
function flowJoinFor(
  index: number,
  count: number,
): "start" | "end" | "both" | undefined {
  if (count < 2) return undefined;
  if (index === 0) return "end";
  return index === count - 1 ? "start" : "both";
}

const hasResponseAfterThinking = computed(
  () =>
    props.hasResponseAfterThinking ??
    props.message.blocks.some((block) => block.type !== "thinking"),
);

/** One decimal is shown below this; whole seconds from here on. */
const FRACTIONAL_SECONDS_UNTIL_MS = 10_000;
const ELAPSED_TICK_MS = 250;
const secondsFormat = computed(
  () => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }),
);
const integerFormat = computed(() => new Intl.NumberFormat(locale.value));

function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) {
    return t("project.transcript.thinkingDuration.lessThanSecond");
  }
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) {
    return t("project.transcript.thinkingDuration.seconds", {
      value: secondsFormat.value.format(
        durationMs < FRACTIONAL_SECONDS_UNTIL_MS
          ? durationMs / 1_000
          : totalSeconds,
      ),
    });
  }
  return t("project.transcript.thinkingDuration.minutes", {
    minutes: integerFormat.value.format(Math.floor(totalSeconds / 60)),
    seconds: integerFormat.value.format(totalSeconds % 60),
  });
}

const elapsedDurationMs = computed(() =>
  Math.max(0, now.value - (props.message.thinkingStartedAt ?? now.value)),
);
const summaryLabel = computed(() => {
  const duration = formatDuration(
    isStreaming.value
      ? elapsedDurationMs.value
      : props.message.thinkingDurationMs,
  );
  if (isStreaming.value) {
    return t("project.transcript.thinkingActive", { duration });
  }
  return duration
    ? t("project.transcript.thinkingComplete", { duration })
    : t("project.transcript.thinkingCompleteWithoutDuration");
});

function stopElapsedTimer(): void {
  if (elapsedTimer === undefined) return;
  window.clearTimeout(elapsedTimer);
  elapsedTimer = undefined;
}

/**
 * Delay until the label can next change: a quarter second while a decimal is
 * shown, then the next half-second boundary, where the rounded whole second
 * flips. Ticking faster than the label changes only re-renders it.
 */
function nextElapsedTickDelay(): number {
  const elapsed = elapsedDurationMs.value;
  if (elapsed < FRACTIONAL_SECONDS_UNTIL_MS) return ELAPSED_TICK_MS;
  return 1_000 - ((elapsed - 500) % 1_000) + 1;
}

function scheduleElapsedTick(): void {
  elapsedTimer = window.setTimeout(() => {
    now.value = Date.now();
    scheduleElapsedTick();
  }, nextElapsedTickDelay());
}

function syncElapsedTimer(streaming: boolean): void {
  stopElapsedTimer();
  now.value = Date.now();
  if (!streaming) return;
  scheduleElapsedTick();
}

/** Records which edges hide content; the fade attribute follows from it. */
function updateScrollEdges(scrollTop: number, maxTop: number): void {
  const above = scrollTop > FADE_EDGE_THRESHOLD;
  const below = maxTop - scrollTop > FADE_EDGE_THRESHOLD;
  if (hasHiddenContentAbove.value !== above)
    hasHiddenContentAbove.value = above;
  if (hasHiddenContentBelow.value !== below)
    hasHiddenContentBelow.value = below;
  const scrollable = maxTop > FADE_EDGE_THRESHOLD;
  if (isPanelScrollable.value !== scrollable)
    isPanelScrollable.value = scrollable;
}

/**
 * While following the stream the bottom stays faded: each update grows the
 * text before the panel glides to it, so the fade would otherwise flicker on
 * and off with every update. Once the stream ends, the next scroll event
 * clears it.
 */
const scrollableAttr = computed(() => {
  const below =
    hasHiddenContentBelow.value ||
    (isStreaming.value && isFollowingThinking.value && isPanelScrollable.value);
  const edges = [hasHiddenContentAbove.value && "start", below && "end"].filter(
    Boolean,
  );
  return edges.length > 0 ? edges.join(" ") : undefined;
});

/**
 * Runs after layout whenever the rendered thinking grows or reflows, so the
 * measurements here force no extra layout. While following the stream (and
 * once after opening) the panel glides to the newest line: one scroll write
 * and one compositor animation per update (at most four a second), nothing
 * per frame.
 */
function handleThinkingBodyResize(): void {
  const content = thinkingContent.value;
  const body = thinkingBody.value;
  if (!content || !body) return;
  // The body's layout height ignores the glide's transform, which a
  // scrollHeight read would include. The panel has no vertical padding; any
  // added later belongs in this range.
  const target = Math.max(0, body.offsetHeight - content.clientHeight);
  panelMetrics = { range: target };
  updateScrollEdges(content.scrollTop, target);
  if (!isExpanded.value) return;
  const pin =
    pendingOpenPin || (isStreaming.value && isFollowingThinking.value);
  if (!pin || target === lastPinTarget) return;
  pendingOpenPin = false;
  lastPinTarget = target;
  follow.glideTo(target);
}

/** The next size report (the first one after mounting) glides to the end. */
function pinOnOpen(): void {
  pendingOpenPin = true;
  lastPinTarget = undefined;
}

function toggleExpanded(): void {
  isExpanded.value = !isExpanded.value;
  if (!isExpanded.value) return;
  isFollowingThinking.value = true;
  pinOnOpen();
  // Reopened before the fold finished: the body never left, so no size
  // report follows; the last measured range still holds.
  if (panelMetrics) {
    pendingOpenPin = false;
    lastPinTarget = panelMetrics.range;
    follow.glideTo(panelMetrics.range);
  }
}

function handleThinkingScroll(event: Event): void {
  const content = event.currentTarget as HTMLElement;
  // The range comes from the last resize report; only the position is read.
  const maxTop =
    panelMetrics?.range ??
    Math.max(0, content.scrollHeight - content.clientHeight);
  const scrollTop = content.scrollTop;
  updateScrollEdges(scrollTop, maxTop);
  const nearBottom = maxTop - scrollTop <= 24;
  if (nearBottom) {
    isFollowingThinking.value = true;
    hasThinkingUserScrollIntent.value = false;
    return;
  }
  if (hasThinkingUserScrollIntent.value) isFollowingThinking.value = false;
  hasThinkingUserScrollIntent.value = false;
}

/** The user takes over: a running glide stops where it shows. */
function markThinkingUserScrollIntent(): void {
  hasThinkingUserScrollIntent.value = true;
  follow.interrupt();
}

watch(
  isStreaming,
  (streaming) => {
    syncElapsedTimer(streaming);
  },
  { immediate: true },
);
watch(
  [
    () => props.message.id,
    () => thinkingSegments.value.some(Boolean),
    hasResponseAfterThinking,
  ],
  ([messageId, hasThinking, hasResponse], previous) => {
    const messageChanged = messageId !== previous?.[0];
    const thinkingStarted = hasThinking && !previous?.[1];
    if (messageChanged) {
      isExpanded.value = false;
      isFollowingThinking.value = true;
      if (previous) resetBlockView();
    }
    if (hasResponse) {
      if (
        isExpanded.value &&
        (props.hasTextAfterThinking ??
          props.message.blocks.some((block) => block.type === "text"))
      )
        scroller?.preserveViewportOnCollapse(
          thinkingContent.value ?? undefined,
        );
      isExpanded.value = false;
      return;
    }
    if (isStreaming.value && (messageChanged || thinkingStarted)) {
      isExpanded.value = true;
      isFollowingThinking.value = true;
      pinOnOpen();
      void nextTick(() => {
        scroller?.followStreamingContent();
      });
    }
  },
  { immediate: true },
);
// Before the panel renders, so it mounts straight into the block view. Runs
// after the message watch above, which resets the view for a new message.
watch(
  [isContentMounted, isStreaming, () => props.message.id],
  ([mounted, streaming]) => {
    if (mounted && streaming) startBlockView();
  },
  { immediate: true },
);
watch(isExpanded, (expanded) => {
  if (!expanded) follow.interrupt();
});
watch(
  thinkingBody,
  (body, previous) => {
    if (previous) bodyObserver?.unobserve(previous);
    if (!body) {
      // The panel unmounted on collapse; it remeasures when it mounts again.
      follow.cancel();
      panelMetrics = undefined;
      lastPinTarget = undefined;
      // A later mount starts over: the block view again while thinking
      // streams, the single render once it is done.
      if (previous) resetBlockView();
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
    bodyObserver ??= new ResizeObserver(handleThinkingBodyResize);
    bodyObserver.observe(body);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  stopElapsedTimer();
  cancelThinkingUpdate();
  bodyObserver?.disconnect();
  bodyObserver = undefined;
});
</script>

<template>
  <div class="group/thinking">
    <Marker
      as="button"
      type="button"
      class="w-fit cursor-pointer rounded-sm select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :aria-controls="contentId"
      :aria-expanded="isExpanded"
      @click="toggleExpanded"
    >
      <MarkerContent>{{ summaryLabel }}</MarkerContent>

      <MarkerIcon>
        <ChevronRightIcon
          class="transition-transform duration-500 ease-out-expo motion-reduce:transition-none"
          :class="isExpanded && 'rotate-90'"
        />
      </MarkerIcon>
    </Marker>

    <div
      :id="contentId"
      class="grid transition-[grid-template-rows,opacity] duration-500 ease-out-expo motion-reduce:transition-none"
      :class="
        isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      "
      :aria-hidden="!isExpanded"
    >
      <div class="min-h-0 overflow-hidden">
        <div
          v-if="isContentMounted"
          ref="thinkingContent"
          data-thinking-content
          :data-scrollable="scrollableAttr"
          class="thinking-scroll-fade no-scrollbar mt-3 max-h-64 overflow-y-auto overscroll-contain pl-6 pr-3 text-sm text-muted-foreground"
          @scroll.passive="handleThinkingScroll"
          @wheel.passive="markThinkingUserScrollIntent"
          @touchstart.passive="markThinkingUserScrollIntent"
          @pointerdown.passive="markThinkingUserScrollIntent"
        >
          <!-- Thinking renders through the same markdown pipeline as the
               message body (reasoning carries lists/code/math too); the
               compact variant keeps the muted small-type panel. While it
               streams, each Markdown block renders on its own so an update
               re-renders only the block being written; only that block is
               not `final`, so deltas fade there alone. `flow-join` lets the
               blocks' margins collapse as in one render, so the spacing
               matches the finished view. -->
          <div ref="thinkingBody">
            <template v-if="useBlockView">
              <MarkdownContent
                v-for="(item, index) in blockItems"
                :key="item.key"
                :source="item.source"
                :final="item.final"
                :flow-join="flowJoinFor(index, blockItems.length)"
                compact
              />
            </template>
            <MarkdownContent
              v-else
              :source="shownThinkingText"
              :final="message.thinkingStatus !== 'streaming'"
              compact
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Edge fades keyed to the panel's scroll state, as the transcript viewport
 * does (`.message-scroller-fade`), instead of shadcn's scroll-fade utility.
 * That one animates registered properties on a scroll timeline, which cannot
 * run on the compositor: every frame of the follow glide waited on a
 * main-thread style recalc and a mask repaint. Here the mask changes only
 * when an edge is crossed, with a short transition. The fade length matches
 * the utility's default.
 */
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
  .thinking-scroll-fade {
    transition: none;
  }
}
</style>
