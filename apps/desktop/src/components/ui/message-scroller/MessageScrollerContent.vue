<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { cn } from "@/lib/utils";
import { useMessageScrollerContext } from "./useMessageScroller";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  spacerClass?: HTMLAttributes["class"];
}>();

const {
  handleContentChange,
  followingBottom,
  handleResize,
  setContentElement,
  setSpacerElement,
} = useMessageScrollerContext();

/**
 * While the scroller follows the bottom, the tail sticks to the viewport's
 * bottom edge, where it rests anyway. A growing reply then scrolls under it
 * instead of pushing it down for the frames the scroll takes to catch up.
 * A new turn's anchor hold leaves it in flow: the anchor spacer already
 * rests it at the bottom, and a reply that runs past the fold must not be
 * covered by it. The reader's first scroll releases it, so it moves with the
 * transcript from the first pixel.
 */
const pinsTail = computed(() => followingBottom.value);

const contentRef = useTemplateRef<HTMLElement>("content");
const spacerRef = useTemplateRef<HTMLElement>("spacer");

let mutationObserver: MutationObserver | null = null;
let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  const content = contentRef.value;
  if (!content) return;

  setContentElement(content);
  setSpacerElement(spacerRef.value ?? null);
  handleContentChange();

  if (typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(() => handleContentChange());
    mutationObserver.observe(content, { childList: true });
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      // ResizeObserver runs before paint. Restore the anchor here so a new
      // content height cannot be displayed at the old scroll position.
      handleResize();
    });
    resizeObserver.observe(content);
  }
});

onBeforeUnmount(() => {
  mutationObserver?.disconnect();
  resizeObserver?.disconnect();
  mutationObserver = null;
  resizeObserver = null;
  setContentElement(null);
  setSpacerElement(null);
});
</script>

<template>
  <div
    ref="content"
    data-slot="message-scroller-content"
    role="log"
    aria-relevant="additions"
    :class="cn('flex h-max min-h-full flex-col gap-8', props.class)"
  >
    <slot />
    <div
      ref="spacer"
      aria-hidden="true"
      data-message-scroller-spacer=""
      hidden
      :class="props.spacerClass"
    />
    <!-- Below the spacer and outside the items. It takes up the room a short
         transcript leaves and keeps its content at the bottom, so the
         content sits at the viewport's bottom from the start and a growing
         reply never pushes it down. The tail cancels the item gap and spaces
         itself, so it can animate that space away with its content. It lets
         clicks through to the transcript under it; its content opts back
         in. `bottom-8` matches the content's bottom padding. -->
    <div
      v-if="$slots.tail"
      data-message-scroller-tail=""
      :data-pinned="pinsTail ? '' : undefined"
      :class="
        cn(
          'pointer-events-none -mt-8 flex grow flex-col justify-end empty:hidden',
          pinsTail && 'sticky bottom-8 z-10',
        )
      "
    >
      <slot name="tail" />
    </div>
  </div>
</template>
