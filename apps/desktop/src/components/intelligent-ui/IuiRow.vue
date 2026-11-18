<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { ALIGN, GAP, JUSTIFY, pick } from "./layout";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Row">>>();

const classes = computed(() => {
  const { gap, align, justify, wrap } = props.props;
  return cn(
    "flex min-w-0 flex-row",
    pick(GAP, gap) ?? GAP.sm,
    pick(ALIGN, align) ?? ALIGN.center,
    pick(JUSTIFY, justify),
    wrap && "flex-wrap",
  );
});
</script>

<template>
  <div data-iui="row" :class="classes">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
