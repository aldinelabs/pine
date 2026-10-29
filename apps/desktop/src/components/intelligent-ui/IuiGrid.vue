<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Grid">>>();

/** Columns collapse below a minimum width instead of squeezing. */
const style = computed(() => ({
  gridTemplateColumns: `repeat(auto-fit, minmax(max(10rem, calc((100% - ${(props.props.columns ?? 2) - 1} * 0.75rem) / ${props.props.columns ?? 2})), 1fr))`,
}));
</script>

<template>
  <div data-slot="iui-grid" class="grid min-w-0 gap-3" :style="style">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
