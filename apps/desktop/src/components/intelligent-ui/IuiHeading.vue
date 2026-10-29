<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Heading">>>();

const LEVELS = {
  1: { tag: "h3", class: "text-lg font-semibold tracking-tight" },
  2: { tag: "h4", class: "text-base font-semibold" },
  3: { tag: "h5", class: "text-sm font-semibold" },
} as const;

const level = computed(
  () => LEVELS[(props.props.level ?? 2) as keyof typeof LEVELS] ?? LEVELS[2],
);
</script>

<template>
  <component :is="level.tag" data-iui="heading" :class="level.class">
    {{ props.props.text }}
  </component>
</template>
