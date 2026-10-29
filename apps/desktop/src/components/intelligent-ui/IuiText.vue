<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Text">>>();

const TONE = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-warning",
  danger: "text-destructive",
} as const;
const WEIGHT = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
} as const;

const classes = computed(() =>
  cn(
    "leading-relaxed text-pretty whitespace-pre-line",
    props.props.size === "md" ? "text-base" : "text-sm",
    TONE[props.props.tone ?? "default"],
    WEIGHT[props.props.weight ?? "normal"],
  ),
);
</script>

<template>
  <p data-slot="iui-text" :class="classes">{{ props.props.text }}</p>
</template>
