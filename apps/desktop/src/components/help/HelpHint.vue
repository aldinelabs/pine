<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import { useMediaQuery } from "@vueuse/core";
import type { HelpTopicId } from "@/app/help";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * The question mark beside a setting. With a guide that explains the
 * setting, clicking it opens that guide; without one, or with Guide buttons
 * off, it shows the short description in the slot instead.
 */
const props = defineProps<{
  label: string;
  guide?: { topic: HelpTopicId; step?: number };
}>();

const appearance = useAppearanceStore();
const help = useHelpStore();

/** Tooltips only open on hover; touch screens get a tap-to-open popover. */
const canHover = useMediaQuery("(hover: hover)");

function openGuide(): void {
  if (props.guide) help.openTopic(props.guide.topic, props.guide.step);
}
</script>

<template>
  <Badge
    v-if="guide && appearance.helpGuides"
    as="button"
    type="button"
    variant="secondary"
    class="size-5 translate-y-px p-0"
    data-slot="help-hint-guide"
    :aria-label="label"
    aria-haspopup="dialog"
    @click="openGuide"
  >
    <CircleHelpIcon aria-hidden="true" />
  </Badge>
  <TooltipProvider v-else-if="canHover" :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <Badge
          as="button"
          type="button"
          variant="secondary"
          class="size-5 translate-y-px p-0"
          :aria-label="label"
        >
          <CircleHelpIcon aria-hidden="true" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="4">
        <slot />
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Popover v-else>
    <PopoverTrigger as-child>
      <Badge
        as="button"
        type="button"
        variant="secondary"
        class="size-5 translate-y-px p-0"
        :aria-label="label"
      >
        <CircleHelpIcon aria-hidden="true" />
      </Badge>
    </PopoverTrigger>
    <PopoverContent side="top" :side-offset="4" class="w-auto max-w-xs p-3">
      <slot />
    </PopoverContent>
  </Popover>
</template>
