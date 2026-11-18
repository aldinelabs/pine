<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Grid">>>();

/**
 * Columns collapse below a minimum width instead of squeezing: 10rem by
 * default, or the block's minChildWidth in px.
 */
const style = computed(() => {
  const columns = Math.min(
    12,
    Math.max(1, Math.round(props.props.columns ?? 2)),
  );
  const width = props.props.minChildWidth;
  const min =
    typeof width === "number" && width > 0 ? `${Math.round(width)}px` : "10rem";
  return {
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(${min}, calc((100% - ${columns - 1} * 1rem) / ${columns}))), 1fr))`,
  };
});
</script>

<template>
  <div data-iui="grid" class="grid min-w-0 gap-4" :style="style">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
