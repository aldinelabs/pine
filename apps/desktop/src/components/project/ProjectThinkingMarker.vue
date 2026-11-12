<script setup lang="ts">
import { useMountedWhileOpen } from "@/composables/useMountedWhileOpen";
import { ChevronRightIcon } from "@lucide/vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { animateScrollTop, prefersReducedMotion } from "@/lib/animateScroll";
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
let scrollAnimation: (() => void) | undefined;
/** Panel scroll range, measured after layout by the resize observer. */
let panelMetrics: { scrollHeight: number; clientHeight: number } | undefined;
/** The bottom the panel was last sent to, so a repeat report does nothing. */
let lastPinTarget: number | undefined;
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

const thinkingText = computed(() =>
  props.message.blocks
    .filter((block) => block.type === "thinking")
    .map((block) => (block.type === "thinking" ? block.thinking : ""))
    .join("\n"),
);

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

function cancelScrollAnimation(): void {
  scrollAnimation?.();
  scrollAnimation = undefined;
}

function measurePanel(content: HTMLElement) {
  panelMetrics = {
    scrollHeight: content.scrollHeight,
    clientHeight: content.clientHeight,
  };
  return panelMetrics;
}

function maxScrollTop(metrics: {
  scrollHeight: number;
  clientHeight: number;
}): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
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
 * The follow glide trails the newest line, so the bottom stays faded for the
 * whole stream. Holding the fade on while following keeps each landing of the
 * glide from pulsing it; once the stream ends, the glide's final scroll event
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

function scrollThinkingToBottom(): void {
  const content = thinkingContent.value;
  if (!content) return;
  const target = maxScrollTop(measurePanel(content));
  lastPinTarget = target;
  scrollAnimation = animateScrollTop(content, target);
}

/**
 * Runs after layout whenever the rendered thinking grows or reflows, so the
 * measurements here force no extra layout. While following the stream the
 * panel glides to the newest line with the browser's own smooth scroll,
 * which runs off the main thread and retargets itself on the next update.
 */
function handleThinkingBodyResize(): void {
  const content = thinkingContent.value;
  if (!content) return;
  const target = maxScrollTop(measurePanel(content));
  updateScrollEdges(content.scrollTop, target);
  if (!isStreaming.value || !isExpanded.value || !isFollowingThinking.value) {
    return;
  }
  if (target === lastPinTarget) return;
  lastPinTarget = target;
  cancelScrollAnimation();
  content.scrollTo({
    top: target,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

async function toggleExpanded(): Promise<void> {
  isExpanded.value = !isExpanded.value;
  if (!isExpanded.value) return;
  isFollowingThinking.value = true;
  await nextTick();
  scrollThinkingToBottom();
}

function handleThinkingScroll(event: Event): void {
  const content = event.currentTarget as HTMLElement;
  // The range comes from the last resize report; only the position is read.
  const maxTop = maxScrollTop(panelMetrics ?? measurePanel(content));
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

function markThinkingUserScrollIntent(): void {
  hasThinkingUserScrollIntent.value = true;
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
    () => Boolean(thinkingText.value),
    hasResponseAfterThinking,
  ],
  ([messageId, hasThinking, hasResponse], previous) => {
    const messageChanged = messageId !== previous?.[0];
    const thinkingStarted = hasThinking && !previous?.[1];
    if (messageChanged) {
      isExpanded.value = false;
      isFollowingThinking.value = true;
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
      void nextTick(() => {
        scroller?.followStreamingContent();
        scrollThinkingToBottom();
      });
    }
  },
  { immediate: true },
);
watch(
  thinkingBody,
  (body, previous) => {
    if (previous) bodyObserver?.unobserve(previous);
    if (!body) {
      // The panel unmounted on collapse; it remeasures when it mounts again.
      panelMetrics = undefined;
      lastPinTarget = undefined;
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
  cancelScrollAnimation();
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
               compact variant keeps the muted small-type panel. `final`
               follows the thinking block, not the whole message, so deltas
               fade only while thinking streams. -->
          <div ref="thinkingBody">
            <MarkdownContent
              :source="thinkingText"
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
