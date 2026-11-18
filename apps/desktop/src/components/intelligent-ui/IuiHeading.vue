<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Heading">>>();

const LEVELS = {
  1: { tag: "h3", class: "text-lg font-semibold tracking-tight" },
  2: { tag: "h4", class: "text-base font-semibold" },
  3: { tag: "h5", class: "text-sm font-semibold" },
} as const;
/** A size overrides the level's look; the level still picks the tag. */
const SIZES = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
  lg: "text-lg font-semibold tracking-tight",
  xl: "text-xl font-semibold tracking-tight",
  "2xl": "text-2xl font-semibold tracking-tight tabular-nums",
  "3xl": "text-3xl font-semibold tracking-tight tabular-nums",
} as const;

const level = computed(
  () => LEVELS[(props.props.level ?? 2) as keyof typeof LEVELS] ?? LEVELS[2],
);
const classes = computed(() => {
  const size = props.props.size;
  return cn(
    "text-balance",
    size && size in SIZES ? SIZES[size] : level.value.class,
  );
});
</script>

<template>
  <component :is="level.tag" data-iui="heading" :class="classes">
    {{ props.props.text }}
  </component>
</template>
