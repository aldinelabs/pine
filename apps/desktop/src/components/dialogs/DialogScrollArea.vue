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
  }>(),
  { edgeInset: "1.25rem" },
);
const viewport =
  useTemplateRef<InstanceType<typeof ScrollAreaViewport>>("viewport");
defineExpose({ viewport: computed(() => viewport.value?.viewportElement) });
const emit = defineEmits<{ scroll: [event: Event] }>();
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
      <div :class="cn('min-w-0 pe-(--dialog-scroll-edge)', contentClass)">
        <slot />
      </div>
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>
