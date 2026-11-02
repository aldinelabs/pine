<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import { useMediaQuery } from "@vueuse/core";
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

defineProps<{ label: string }>();

/** Tooltips only open on hover; touch screens get a tap-to-open popover. */
const canHover = useMediaQuery("(hover: hover)");
</script>

<template>
  <TooltipProvider v-if="canHover" :delay-duration="300">
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
