<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import type { HelpTopicId } from "@/app/help";
import { Button } from "@/components/ui/button";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * A labelled button that opens one of Pine's guides, for places with room
 * for a line of text (popovers, cards). It says what it opens instead of
 * hiding behind a hover tooltip, and disappears with Guide buttons off in
 * General settings. Menus use a menu item of the same shape instead.
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
  <!-- The negative margin lines the icon up with the text around it; the
       hover fill still has room on its own. -->
  <Button
    v-if="appearance.helpGuides"
    data-slot="help-guide-button"
    type="button"
    variant="ghost"
    size="sm"
    class="text-muted-foreground -ms-2 self-start"
    aria-haspopup="dialog"
    @click="openGuide"
  >
    <CircleHelpIcon data-icon="inline-start" />
    {{ label }}
  </Button>
</template>
