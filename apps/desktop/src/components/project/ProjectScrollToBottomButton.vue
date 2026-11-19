<script lang="ts">
/** The least distance above the bottom, in px, before the button shows. */
export const SCROLL_TO_BOTTOM_MIN_DISTANCE = 400;

/**
 * Whether the button should show at `distance` px above the bottom, given
 * whether it shows now. It appears once the reader is a viewport height
 * (at least 400px) away, when the latest content is entirely out of view,
 * and goes again only below half that, so it does not flicker at the edge.
 */
export function showsScrollToBottom(
  distance: number,
  viewportHeight: number,
  shown: boolean,
): boolean {
  const showAt = Math.max(SCROLL_TO_BOTTOM_MIN_DISTANCE, viewportHeight);
  return shown ? distance >= showAt / 2 : distance >= showAt;
}
</script>

<script setup lang="ts">
import { ArrowDownIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useMessageScrollerContext } from "@/components/ui/message-scroller/useMessageScroller";

/**
 * The transcript's scroll-to-bottom button: shadcn-vue's message-scroller
 * button (same enter/leave transition), at the size of the composer's Send
 * button, edged like a popover: a faint ring and shadow, no border. It sits
 * at the bottom end of the message column. Hover and press match Pine's
 * outline buttons, kept opaque over the text. The engine's at-bottom state
 * still hides it, but
 * it only appears once the reader has scrolled a meaningful distance up.
 * Distance is measured on scroll only, so a reply growing below a reader
 * resting just above the bottom does not bring it in.
 */
const { followingBottom, scrollable, scrollToEnd } =
  useMessageScrollerContext();
const { t } = useI18n();

const root = ref<InstanceType<typeof Button> | null>(null);
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

function onClick(event: MouseEvent): void {
  if (!active.value) return;
  (event.currentTarget as HTMLElement | null)?.blur();
  scrollToEnd({ behavior: "smooth" });
}
</script>

<template>
  <Button
    ref="root"
    data-slot="scroll-to-bottom-button"
    :data-active="active ? 'true' : 'false'"
    variant="secondary"
    size="icon-lg"
    :inert="!active"
    :tabindex="active ? undefined : -1"
    class="scroll-to-bottom-button absolute bottom-4 rounded-full border-transparent bg-background text-foreground shadow-md ring-1 ring-foreground/10 hover:bg-muted hover:text-foreground dark:hover:bg-[color-mix(in_srgb,var(--background),var(--foreground)_5%)] data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:scale-100 data-[active=true]:opacity-100"
    @click="onClick"
  >
    <ArrowDownIcon />
    <span class="sr-only">{{ t("project.transcript.scrollToBottom") }}</span>
  </Button>
</template>

<style scoped>
/*
 * Aligned with the end edge of the message column (see
 * `.session-transcript-content`): the column is centred and capped, so its
 * end edge is the larger of the side padding and half the leftover width.
 * Logical insets keep it on the end side in RTL without a translate.
 */
.scroll-to-bottom-button {
  inset-inline-end: max(
    calc(var(--session-composer-gutter) + var(--session-input-padding-inline)),
    calc((100% - var(--session-content-max-width)) / 2)
  );
  /*
   * Show/hide keeps the official timing; colours and the press nudge keep
   * the base button's, which `transition-all` would have given them.
   */
  transition-property:
    translate, scale, opacity, background-color, color, box-shadow;
  transition-duration:
    200ms, 200ms, 200ms, var(--default-transition-duration),
    var(--default-transition-duration), var(--default-transition-duration);
  transition-timing-function:
    cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1),
    cubic-bezier(0.23, 1, 0.32, 1), var(--default-transition-timing-function),
    var(--default-transition-timing-function),
    var(--default-transition-timing-function);
}

.scroll-to-bottom-button[data-active="false"] {
  transition-duration:
    400ms, 400ms, 400ms, var(--default-transition-duration),
    var(--default-transition-duration), var(--default-transition-duration);
  transition-timing-function:
    cubic-bezier(0.7, 0, 0.84, 0), cubic-bezier(0.7, 0, 0.84, 0),
    cubic-bezier(0.7, 0, 0.84, 0), var(--default-transition-timing-function),
    var(--default-transition-timing-function),
    var(--default-transition-timing-function);
}
</style>
