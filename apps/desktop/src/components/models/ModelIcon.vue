<script setup lang="ts">
import { CpuIcon } from "@lucide/vue";
import { computed } from "vue";
import { type ModelIconSource, resolveModelIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

// Attributes (e.g. a button's `data-icon`) go to whichever icon renders.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  model: ModelIconSource;
}>();

const icon = computed(() => resolveModelIcon(props.model));
</script>

<template>
  <img
    v-if="icon"
    v-bind="$attrs"
    aria-hidden="true"
    data-slot="model-icon"
    :src="icon.src"
    alt=""
    :class="cn('size-4 shrink-0', { 'dark:invert': icon.monochrome })"
  />
  <!-- Unknown vendor: the caller's generic icon for this kind of row. -->
  <slot v-else name="fallback">
    <CpuIcon v-bind="$attrs" aria-hidden="true" />
  </slot>
</template>
