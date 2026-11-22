<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import type { HelpTopicId } from "@/app/help";
import { Button } from "@/components/ui/button";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * Opens one of Pine's guides from the top of a popover: a row shaped like
 * a dropdown menu item, set above an edge-to-edge divider in a popover with
 * a menu's padding (p-1.5), so it matches the guide item in menus. It disappears with Guide
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
    class="hover:bg-accent hover:text-accent-foreground h-auto w-full justify-start gap-2.5 rounded-2xl px-3 py-2 font-medium has-data-[icon=inline-start]:pl-3"
    aria-haspopup="dialog"
    @click="openGuide"
  >
    <CircleHelpIcon data-icon="inline-start" />
    {{ label }}
  </Button>
</template>
