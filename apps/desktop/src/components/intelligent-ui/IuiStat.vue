<script setup lang="ts">
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useSurface } from "./surface";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Stat">>>();
const surface = useSurface();

const TRENDS = {
  up: { icon: TrendingUpIcon, class: "text-emerald-600 dark:text-emerald-400" },
  down: { icon: TrendingDownIcon, class: "text-destructive" },
  flat: { icon: MinusIcon, class: "text-muted-foreground" },
} as const;

const trend = computed(() =>
  props.props.trend ? TRENDS[props.props.trend] : undefined,
);
const value = computed(() =>
  typeof props.props.value === "number"
    ? props.props.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : props.props.value,
);
</script>

<template>
  <Item
    data-iui="stat"
    size="sm"
    :variant="surface === 'raised' ? 'muted' : 'outline'"
    :class="['min-w-0 items-start', surface === 'inset' && 'bg-background']"
  >
    <ItemContent class="min-w-0 gap-1">
      <ItemDescription>{{ props.props.label }}</ItemDescription>
      <ItemTitle class="text-xl font-semibold tracking-tight tabular-nums">
        {{ value }}
      </ItemTitle>
      <span
        v-if="props.props.caption || trend"
        :class="[
          'flex items-center gap-1 text-xs',
          trend?.class ?? 'text-muted-foreground',
        ]"
      >
        <component :is="trend.icon" v-if="trend" class="size-3.5" />
        {{ props.props.caption }}
      </span>
    </ItemContent>
  </Item>
</template>
