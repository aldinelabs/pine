<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { ALIGN, GAP, JUSTIFY, pick } from "./layout";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Stack">>>();

const classes = computed(() => {
  const { direction, gap, align, justify, wrap } = props.props;
  const row = direction === "row";
  return cn(
    "flex min-w-0",
    row ? "flex-row" : "flex-col",
    pick(GAP, gap) ?? (row ? GAP.sm : GAP.md),
    pick(ALIGN, align) ?? (row ? ALIGN.center : ALIGN.stretch),
    pick(JUSTIFY, justify),
    wrap && "flex-wrap",
  );
});
</script>

<template>
  <div data-iui="stack" :class="classes">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
