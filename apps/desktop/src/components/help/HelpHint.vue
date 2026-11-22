<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import { useMediaQuery } from "@vueuse/core";
import { computed, useSlots } from "vue";
import { useI18n } from "vue-i18n";
import { resolveHelpTopic, type HelpTopicId } from "@/app/help";
import type { AppLocale } from "@/app/i18n";
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
import { useHelpStore } from "@/stores/help";

/**
 * The one question mark Pine shows beside a feature. With a `topic`,
 * clicking it opens that guide in the tutorial dialog and the hover tooltip
 * says so; without one, it only explains the slot's text, as a tooltip (or a
 * tap-to-open popover on touch screens).
 */
const props = defineProps<{
  label?: string;
  topic?: HelpTopicId;
  /** The guide's step to open at, 0-based. */
  step?: number;
}>();
const emit = defineEmits<{ open: [] }>();

const { t, locale } = useI18n();
const slots = useSlots();
const help = useHelpStore();

/** Tooltips only open on hover; touch screens get a tap-to-open popover. */
const canHover = useMediaQuery("(hover: hover)");

const accessibleLabel = computed(() => {
  if (props.label) return props.label;
  if (!props.topic) return t("common.help");
  const { title } = resolveHelpTopic(props.topic, locale.value as AppLocale);
  return t("help.hintLabel", { topic: title });
});

function openGuide(): void {
  if (!props.topic) return;
  emit("open");
  help.openTopic(props.topic, props.step);
}
</script>

<template>
  <TooltipProvider v-if="canHover || topic" :delay-duration="300">
    <Tooltip>
      <TooltipTrigger as-child>
        <Badge
          as="button"
          type="button"
          variant="secondary"
          data-slot="help-hint"
          class="size-5 translate-y-px p-0"
          :aria-label="accessibleLabel"
          :aria-haspopup="topic ? 'dialog' : undefined"
          @click="openGuide"
        >
          <CircleHelpIcon aria-hidden="true" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" :side-offset="4" class="max-w-xs">
        <slot />
        <span
          v-if="topic"
          :class="['block', slots.default && 'mt-1 opacity-70']"
        >
          {{ t("help.openGuide") }}
        </span>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <Popover v-else>
    <PopoverTrigger as-child>
      <Badge
        as="button"
        type="button"
        variant="secondary"
        data-slot="help-hint"
        class="size-5 translate-y-px p-0"
        :aria-label="accessibleLabel"
      >
        <CircleHelpIcon aria-hidden="true" />
      </Badge>
    </PopoverTrigger>
    <PopoverContent side="top" :side-offset="4" class="w-auto max-w-xs p-3">
      <slot />
    </PopoverContent>
  </Popover>
</template>
