<script setup lang="ts">
import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
} from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useSurface } from "./surface";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Callout">>>();
const surface = useSurface();

const TONES = {
  info: { icon: InfoIcon, class: "text-info" },
  success: {
    icon: CircleCheckIcon,
    class: "text-emerald-600 dark:text-emerald-400",
  },
  warning: { icon: TriangleAlertIcon, class: "text-warning" },
  danger: { icon: CircleAlertIcon, class: "text-destructive" },
} as const;

const tone = computed(() => TONES[props.props.tone ?? "info"] ?? TONES.info);
</script>

<template>
  <Item
    data-slot="iui-callout"
    role="note"
    size="sm"
    :variant="surface === 'raised' ? 'muted' : 'outline'"
    :class="surface === 'inset' && 'bg-background'"
  >
    <ItemMedia variant="icon" :class="tone.class">
      <component :is="tone.icon" />
    </ItemMedia>
    <ItemContent>
      <ItemTitle v-if="props.props.title">{{ props.props.title }}</ItemTitle>
      <ItemDescription class="line-clamp-none text-pretty">
        {{ props.props.text }}
      </ItemDescription>
    </ItemContent>
  </Item>
</template>
