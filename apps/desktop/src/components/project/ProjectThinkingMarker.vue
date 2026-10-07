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
import { animateScrollTop } from "@/lib/animateScroll";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { useOptionalMessageScrollerContext } from "@/components/ui/message-scroller/useMessageScroller";
import type { PineTranscriptMessage } from "@/stores/session";

const props = defineProps<{
  message: PineTranscriptMessage;
}>();
const { locale, t } = useI18n();
const contentId = useId();
const thinkingContent = useTemplateRef<HTMLElement>("thinkingContent");
const scroller = useOptionalMessageScrollerContext();
const isExpanded = ref(false);
/** Matches the 500ms grid-rows collapse transition below. */
const isContentMounted = useMountedWhileOpen(isExpanded, 500);
const isFollowingThinking = ref(true);
const hasThinkingUserScrollIntent = ref(false);
const now = ref(Date.now());
let elapsedTimer: number | undefined;
let scrollAnimation: (() => void) | undefined;

const isStreaming = computed(
  () => props.message.thinkingStatus === "streaming",
);

const thinkingText = computed(() =>
  props.message.blocks
    .filter((block) => block.type === "thinking")
    .map((block) => (block.type === "thinking" ? block.thinking : ""))
    .join("\n"),
);

const hasResponseAfterThinking = computed(() =>
  props.message.blocks.some((block) => block.type !== "thinking"),
);

function formatDuration(durationMs?: number): string | undefined {
  if (durationMs === undefined) return undefined;
  if (durationMs < 1_000) {
    return t("project.transcript.thinkingDuration.lessThanSecond");
  }
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) {
    return t("project.transcript.thinkingDuration.seconds", {
      value: new Intl.NumberFormat(locale.value, {
        maximumFractionDigits: 1,
      }).format(durationMs < 10_000 ? durationMs / 1_000 : totalSeconds),
    });
  }
  return t("project.transcript.thinkingDuration.minutes", {
    minutes: new Intl.NumberFormat(locale.value).format(
      Math.floor(totalSeconds / 60),
    ),
    seconds: new Intl.NumberFormat(locale.value).format(totalSeconds % 60),
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
  window.clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

function syncElapsedTimer(streaming: boolean): void {
  stopElapsedTimer();
  now.value = Date.now();
  if (!streaming) return;
  elapsedTimer = window.setInterval(() => {
    now.value = Date.now();
  }, 250);
}

function scrollThinkingToBottom(): void {
  const content = thinkingContent.value;
  if (!content) return;
  const target = Math.max(0, content.scrollHeight - content.clientHeight);
  scrollAnimation = animateScrollTop(content, target);
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
  const nearBottom =
    content.scrollHeight - content.clientHeight - content.scrollTop <= 24;
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
  () => thinkingText.value,
  async () => {
    if (!isStreaming.value || !isExpanded.value || !isFollowingThinking.value) {
      return;
    }
    await nextTick();
    scrollThinkingToBottom();
  },
);
onBeforeUnmount(() => {
  stopElapsedTimer();
  scrollAnimation?.();
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
          class="scroll-fade no-scrollbar mt-3 max-h-64 overflow-y-auto overscroll-contain pl-6 pr-3 text-sm text-muted-foreground"
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
          <MarkdownContent
            :source="thinkingText"
            :final="message.thinkingStatus !== 'streaming'"
            compact
          />
        </div>
      </div>
    </div>
  </div>
</template>
