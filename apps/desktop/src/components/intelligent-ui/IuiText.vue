<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { TONE_TEXT } from "./tones";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Text">>>();

const SIZE = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
} as const;
const WEIGHT = {
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
} as const;

/** A list mixes strings with inline components such as Icon or Badge. */
const rich = computed(() => Array.isArray(props.props.text));
const clamp = computed(() => {
  const lines = props.props.maxLines;
  return typeof lines === "number" && lines >= 1
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical" as const,
        WebkitLineClamp: Math.round(lines),
        overflow: "hidden",
      }
    : undefined;
});

const classes = computed(() =>
  cn(
    "leading-relaxed text-pretty whitespace-pre-line",
    SIZE[props.props.size ?? "sm"] ?? SIZE.sm,
    TONE_TEXT[props.props.tone ?? "default"] ?? TONE_TEXT.default,
    WEIGHT[props.props.weight ?? "normal"] ?? WEIGHT.normal,
    props.props.italic && "italic",
    props.props.lineThrough && "line-through",
    // Inline components sit on the text's baseline; icons centre on it.
    rich.value &&
      "[&_[data-iui=badge]]:align-middle [&_[data-iui=icon]]:inline-block [&_[data-iui=icon]]:align-[-0.125em]",
  ),
);
</script>

<template>
  <p data-iui="text" :class="classes" :style="clamp">
    <IuiNodes v-if="rich" :value="props.props.text" />
    <template v-else>{{ props.props.text }}</template>
  </p>
</template>
