<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ScrollToBottomButton, {
  showsScrollToBottom,
} from "@/components/project/ScrollToBottomButton.vue";
import { useMessageScrollerContext } from "@/components/ui/message-scroller/useMessageScroller";

/**
 * The session transcript's scroll-to-bottom button (see
 * `ScrollToBottomButton`), at the bottom end of the message column. The
 * engine's at-bottom state still hides it, but
 * it only appears once the reader has scrolled a meaningful distance up.
 * Distance is measured on scroll only, so a reply growing below a reader
 * resting just above the bottom does not bring it in.
 */
const { followingBottom, scrollable, scrollToEnd } =
  useMessageScrollerContext();
const { t } = useI18n();

const root = ref<InstanceType<typeof ScrollToBottomButton> | null>(null);
const far = ref(false);
const active = computed(() => far.value && scrollable.value.end);

let viewport: HTMLElement | null = null;

function distanceFromBottom(element: HTMLElement): number {
  // Blank room held below an anchored turn is not unread content.
  const spacer = element.querySelector<HTMLElement>(
    "[data-message-scroller-spacer]",
  );
  const spacerHeight = spacer?.hidden ? 0 : (spacer?.offsetHeight ?? 0);
  return Math.max(
    0,
    element.scrollHeight -
      element.clientHeight -
      element.scrollTop -
      spacerHeight,
  );
}

function onScroll(): void {
  if (!viewport) return;
  far.value = showsScrollToBottom(
    distanceFromBottom(viewport),
    viewport.clientHeight,
    far.value,
  );
}

watch(followingBottom, (following) => {
  if (following) far.value = false;
});

onMounted(() => {
  const element = root.value?.$el as HTMLElement | undefined;
  viewport =
    element?.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-slot="message-scroller-viewport"]',
    ) ?? null;
  viewport?.addEventListener("scroll", onScroll, { passive: true });
});

onBeforeUnmount(() => {
  viewport?.removeEventListener("scroll", onScroll);
  viewport = null;
});

function onScrollRequest(): void {
  scrollToEnd({ behavior: "smooth" });
}
</script>

<template>
  <ScrollToBottomButton
    ref="root"
    :active="active"
    :label="t('project.transcript.scrollToBottom')"
    class="session-scroll-to-bottom absolute bottom-4"
    @scroll="onScrollRequest"
  />
</template>

<style scoped>
/*
 * Aligned with the end edge of the message column (see
 * `.session-transcript-content`): the column is centred and capped, so its
 * end edge is the larger of the side padding and half the leftover width.
 * Logical insets keep it on the end side in RTL without a translate.
 */
.session-scroll-to-bottom {
  inset-inline-end: max(
    calc(var(--session-composer-gutter) + var(--session-input-padding-inline)),
    calc((100% - var(--session-content-max-width)) / 2)
  );
}
</style>
