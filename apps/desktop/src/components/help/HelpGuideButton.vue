<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import type { HelpTopicId } from "@/app/help";
import { Button } from "@/components/ui/button";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * Opens one of Pine's guides from the foot of a popover or card: a plain
 * full-width ghost button with an icon and a label, set below a Separator
 * by the parent, with no spacing of its own beyond the container's gap.
 * Menus use a menu item of the same shape instead. It disappears with Guide
 * buttons off in General settings.
 */
const props = defineProps<{
  topic: HelpTopicId;
  label: string;
  /** The guide's step to open at, 0-based. */
  step?: number;
}>();
const emit = defineEmits<{ open: [] }>();

const appearance = useAppearanceStore();
const help = useHelpStore();

function openGuide(): void {
  emit("open");
  help.openTopic(props.topic, props.step);
}
</script>

<template>
  <Button
    v-if="appearance.helpGuides"
    data-slot="help-guide-button"
    type="button"
    variant="ghost"
    size="sm"
    class="w-full justify-start"
    aria-haspopup="dialog"
    @click="openGuide"
  >
    <CircleHelpIcon data-icon="inline-start" />
    {{ label }}
  </Button>
</template>
