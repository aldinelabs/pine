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
import { Button } from "@/components/ui/button";

/**
 * Pine's scroll-to-bottom button, for any scrolling transcript: shadcn-vue's
 * message-scroller button (same enter/leave transition), at the size of the
 * composer's Send button, edged like a popover: a faint ring and shadow, no
 * border. Hover and press match Pine's outline buttons, kept opaque over the
 * text. The caller decides when it is active (see `showsScrollToBottom`)
 * and places it with `absolute` and insets.
 */
const props = defineProps<{
  active: boolean;
  /** Its accessible name. */
  label: string;
}>();
const emit = defineEmits<{ scroll: [] }>();

function onClick(event: MouseEvent): void {
  if (!props.active) return;
  (event.currentTarget as HTMLElement | null)?.blur();
  emit("scroll");
}
</script>

<template>
  <Button
    data-slot="scroll-to-bottom-button"
    :data-active="active ? 'true' : 'false'"
    variant="secondary"
    size="icon-lg"
    :inert="!active"
    :tabindex="active ? undefined : -1"
    class="scroll-to-bottom-button bg-background text-foreground ring-foreground/10 hover:bg-muted hover:text-foreground rounded-full border-transparent shadow-md ring-1 data-[active=false]:pointer-events-none data-[active=false]:translate-y-full data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 dark:hover:bg-[color-mix(in_srgb,var(--background),var(--foreground)_5%)]"
    @click="onClick"
  >
    <ArrowDownIcon aria-hidden="true" />
    <span class="sr-only">{{ label }}</span>
  </Button>
</template>

<style scoped>
/*
 * Show/hide keeps the official timing; colours and the press nudge keep
 * the base button's, which `transition-all` would have given them.
 */
.scroll-to-bottom-button {
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
