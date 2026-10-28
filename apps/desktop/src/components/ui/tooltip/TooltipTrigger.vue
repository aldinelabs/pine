<script setup lang="ts">
import type { TooltipTriggerProps } from "reka-ui";
import { TooltipTrigger } from "reka-ui";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<TooltipTriggerProps>();
</script>

<template>
  <TooltipTrigger data-slot="tooltip-trigger" v-bind="{ ...props, ...$attrs }">
    <slot />
  </TooltipTrigger>
</template>
