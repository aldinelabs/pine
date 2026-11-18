<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { iuiIcon } from "./icons";
import { COLOR_FILL } from "./tones";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Badge">>>();

const icon = computed(() => iuiIcon(props.props.icon));
/** A colour tints the badge; without one the shadcn variant applies. */
const fill = computed(() => {
  const color = props.props.color;
  return color && color in COLOR_FILL ? COLOR_FILL[color] : undefined;
});
</script>

<template>
  <Badge
    data-iui="badge"
    :variant="fill ? 'secondary' : (props.props.variant ?? 'secondary')"
    :class="cn('w-fit', fill)"
  >
    <component :is="icon" v-if="icon" data-icon="inline-start" />
    {{ props.props.text }}
  </Badge>
</template>
