<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { cn } from "@/lib/utils";
import { useMessageScrollerContext } from "./useMessageScroller";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  spacerClass?: HTMLAttributes["class"];
}>();

const {
  handleContentChange,
  handleResize,
  setContentElement,
  setSpacerElement,
} = useMessageScrollerContext();

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
    <!-- Below the spacer and outside the items: while a reply is anchored,
         the spacer gives way so the tail rests at the viewport's bottom and
         stays put as the reply grows; otherwise it scrolls like the
         transcript. The tail cancels the item gap and spaces itself, so it
         can animate that space away with its content. -->
    <div
      v-if="$slots.tail"
      data-message-scroller-tail=""
      class="-mt-8 empty:hidden"
    >
      <slot name="tail" />
    </div>
  </div>
</template>
