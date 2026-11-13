<script setup lang="ts">
import { SparklesIcon } from "@lucide/vue";
import { useMediaQuery } from "@vueuse/core";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();

/** Tooltips only open on hover; touch screens get a tap-to-open popover. */
const canHover = useMediaQuery("(hover: hover)");
const triggerClass =
  "inline-flex w-fit cursor-help items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
</script>

<template>
  <TooltipProvider v-if="canHover" :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          :class="triggerClass"
          data-slot="approval-attribution"
        >
          <SparklesIcon class="size-3 shrink-0" aria-hidden="true" />
          {{ t("project.approvalRequest.explainedBy") }}
          <span class="sr-only">{{
            t("project.approvalRequest.explanationCaveat")
          }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="4" class="max-w-xs">
        {{ t("project.approvalRequest.explanationCaveat") }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Popover v-else>
    <PopoverTrigger as-child>
      <button
        type="button"
        :class="triggerClass"
        data-slot="approval-attribution"
      >
        <SparklesIcon class="size-3 shrink-0" aria-hidden="true" />
        {{ t("project.approvalRequest.explainedBy") }}
        <span class="sr-only">{{
          t("project.approvalRequest.explanationCaveat")
        }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      side="top"
      :side-offset="4"
      class="w-auto max-w-xs p-3 text-xs"
    >
      {{ t("project.approvalRequest.explanationCaveat") }}
    </PopoverContent>
  </Popover>
</template>
