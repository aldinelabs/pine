<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Stack">>>();

/** Steps of the card rhythm: inline (sm), field (md, a FieldGroup apart), section (lg). */
const GAP = { none: "gap-0", sm: "gap-2", md: "gap-5", lg: "gap-8" } as const;
const ALIGN = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
} as const;
const JUSTIFY = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

const classes = computed(() => {
  const { direction, gap, align, justify, wrap } = props.props;
  const row = direction === "row";
  return cn(
    "flex min-w-0",
    row ? "flex-row" : "flex-col",
    GAP[gap ?? (row ? "sm" : "md")],
    ALIGN[align ?? (row ? "center" : "stretch")],
    justify && JUSTIFY[justify],
    wrap && "flex-wrap",
  );
});
</script>

<template>
  <div data-iui="stack" :class="classes">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
