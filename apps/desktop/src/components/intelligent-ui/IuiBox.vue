<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { ALIGN, GAP, PADDING, pick } from "./layout";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Box">>>();

const BACKGROUND = {
  none: "",
  muted: "bg-muted",
  info: "bg-info/10 dark:bg-info/15",
  success: "bg-emerald-600/10 dark:bg-emerald-400/10",
  warning: "bg-warning/10 dark:bg-warning/15",
  danger: "bg-destructive/10 dark:bg-destructive/15",
} as const;
const RADIUS = {
  none: "rounded-none",
  sm: "rounded-md",
  md: "rounded-lg",
  lg: "rounded-2xl",
  full: "rounded-full",
} as const;

const classes = computed(() => {
  const { padding, background, border, radius, direction, gap, align } =
    props.props;
  const row = direction === "row";
  const filled = background !== undefined && background !== "none";
  return cn(
    "flex min-w-0 overflow-hidden",
    row ? "flex-row" : "flex-col",
    pick(GAP, gap) ?? GAP.sm,
    pick(ALIGN, align) ?? (row ? ALIGN.center : ALIGN.stretch),
    pick(PADDING, padding) ?? (filled || border ? PADDING.md : PADDING.none),
    pick(BACKGROUND, background),
    border && "border border-border",
    pick(RADIUS, radius) ?? RADIUS.lg,
  );
});
</script>

<template>
  <div data-iui="box" :class="classes">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
