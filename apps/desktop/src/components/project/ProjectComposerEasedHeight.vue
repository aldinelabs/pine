<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import { ref } from "vue";

/**
 * Eases to the height of what it holds, on the curve the composer's smart
 * context opens with: rows of the composer that come, go or wrap move the
 * input with them instead of jumping. It starts at its content's height.
 */
withDefaults(defineProps<{ animates?: boolean }>(), { animates: true });

const content = ref<HTMLElement | null>(null);
const height = ref<number>();

useResizeObserver(content, ([entry]) => {
  if (entry) height.value = entry.borderBoxSize[0]?.blockSize;
});
</script>

<template>
  <div
    data-slot="composer-eased-height"
    class="w-full shrink-0 overflow-hidden"
    :class="
      animates &&
      'transition-[height] duration-500 ease-out-expo motion-reduce:transition-none'
    "
    :style="height === undefined ? undefined : { height: `${height}px` }"
  >
    <div ref="content" class="flow-root">
      <slot />
    </div>
  </div>
</template>
