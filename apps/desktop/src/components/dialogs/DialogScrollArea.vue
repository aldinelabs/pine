<script setup lang="ts">
import { computed, useTemplateRef, type HTMLAttributes } from "vue";
import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from "reka-ui";
import { ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    viewportClass?: HTMLAttributes["class"];
    contentClass?: HTMLAttributes["class"];
    /** Put the overlay thumb in the dialog's padding, outside the content. */
    edgeInset?: string;
    /** Content's right padding, where the thumb overlays. Defaults to the
     *  edge inset; set it when the scrollbar sits at a flush pane edge. */
    contentInset?: string;
  }>(),
  { edgeInset: "1.25rem" },
);
const viewport =
  useTemplateRef<InstanceType<typeof ScrollAreaViewport>>("viewport");
defineExpose({ viewport: computed(() => viewport.value?.viewportElement) });
const emit = defineEmits<{ scroll: [event: Event] }>();
// Inline, so a content class like `px-5` cannot lose its right half to the
// stylesheet ordering of the `pe` utility.
const contentPadding = computed(() => ({
  paddingInlineEnd: props.contentInset ?? props.edgeInset,
}));
</script>

<template>
  <ScrollAreaRoot
    data-slot="dialog-scroll-area"
    type="auto"
    :class="cn('relative min-h-0 min-w-0', props.class)"
    :style="{
      '--dialog-scroll-edge': edgeInset,
      marginInlineEnd: 'calc(-1 * var(--dialog-scroll-edge))',
    }"
  >
    <ScrollAreaViewport
      ref="viewport"
      data-slot="scroll-area-viewport"
      :class="
        cn(
          'size-full max-h-[inherit] overscroll-contain rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-ring',
          viewportClass,
        )
      "
      @scroll="emit('scroll', $event)"
    >
      <div
        data-slot="dialog-scroll-area-content"
        :class="cn('min-w-0', contentClass)"
        :style="contentPadding"
      >
        <slot />
      </div>
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
