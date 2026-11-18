<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Popover">>>();

/** Plain text reads as a dotted-underline term; components stay as drawn. */
const textTrigger = computed(() => typeof props.props.trigger === "string");
</script>

<template>
  <Popover>
    <PopoverTrigger
      data-iui="popover"
      :class="[
        'inline-flex w-fit cursor-pointer items-center gap-1 rounded-sm text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        textTrigger &&
          'underline decoration-muted-foreground/60 decoration-dotted underline-offset-4 hover:decoration-foreground',
      ]"
    >
      <IuiNodes :value="props.props.trigger" />
    </PopoverTrigger>
    <PopoverContent
      class="flex max-w-80 flex-col gap-2 text-sm leading-relaxed"
      data-iui="popover-content"
    >
      <IuiNodes :value="props.props.content" />
    </PopoverContent>
  </Popover>
</template>
