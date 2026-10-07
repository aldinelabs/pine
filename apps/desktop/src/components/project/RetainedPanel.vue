<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{ active: boolean }>();
// Keep layout as well as component state. Detaching (KeepAlive) or using
// display:none invalidates scroll/virtualizer measurements. The parent supplies
// a positioned, bounded viewport; removing this panel releases its content.
// Unvisited panels do not mount their expensive views.
// Opacity hides the whole subtree immediately: descendants with transition-all
// can otherwise animate inherited visibility and leak through for one frame.
// content-visibility: hidden skips style, layout and paint for the hidden
// subtree while keeping its cached layout and scroll offsets, so background
// panels cost nothing per frame however much content they retain.
const visited = ref(false);

watch(
  () => props.active,
  (active) => {
    if (active) visited.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <div
    data-slot="retained-panel"
    class="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
    :style="{
      visibility: active ? undefined : 'hidden',
      opacity: active ? undefined : 0,
      contentVisibility: active ? undefined : 'hidden',
    }"
    :inert="!active"
    :aria-hidden="active ? undefined : true"
  >
    <slot v-if="visited" />
  </div>
</template>
