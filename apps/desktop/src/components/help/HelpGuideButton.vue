<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import type { HelpTopicId } from "@/app/help";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * Opens one of Pine's guides from the foot of a popover, drawn like the
 * last item of a dropdown menu (the approval mode menu's "How approval modes
 * work"): a full-width row with an icon and a label. The parent puts a
 * Separator above it. It reaches 0.375rem from a `p-4` popover's edges, as
 * menu items sit inside a menu's `p-1.5`. It disappears with Guide buttons
 * off in General settings.
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
  <button
    v-if="appearance.helpGuides"
    data-slot="help-guide-button"
    type="button"
    class="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground -mx-2.5 -mb-2.5 flex items-center gap-2.5 rounded-2xl px-3 py-2 text-start text-sm font-medium outline-hidden select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
    aria-haspopup="dialog"
    @click="openGuide"
  >
    <CircleHelpIcon />
    {{ label }}
  </button>
</template>
