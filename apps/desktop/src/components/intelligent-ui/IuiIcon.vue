<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { iuiIcon } from "./icons";
import { colorText } from "./tones";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Icon">>>();

const SIZE = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
  xl: "size-7",
} as const;
const icon = computed(() => iuiIcon(props.props.name));
</script>

<template>
  <component
    :is="icon"
    v-if="icon"
    data-iui="icon"
    aria-hidden="true"
    :class="
      cn(
        'shrink-0',
        SIZE[props.props.size ?? 'md'] ?? SIZE.md,
        colorText(props.props.color),
      )
    "
  />
</template>
