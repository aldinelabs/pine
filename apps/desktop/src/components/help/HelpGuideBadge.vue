<script setup lang="ts">
import { CircleHelpIcon } from "@lucide/vue";
import type { HelpTopicId } from "@/app/help";
import { Badge } from "@/components/ui/badge";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";

/**
 * A labelled guide button set beside a dialog's title: the question mark of
 * the settings hints with the guide's name. The guide opens on top of the
 * dialog and hands focus back here when it closes. It disappears with Guide
 * buttons off in General settings.
 */
const props = defineProps<{
  topic: HelpTopicId;
  label: string;
  /** The guide's step to open at, 0-based. */
  step?: number;
}>();

const appearance = useAppearanceStore();
const help = useHelpStore();
</script>

<template>
  <Badge
    v-if="appearance.helpGuides"
    as="button"
    type="button"
    variant="secondary"
    data-slot="help-guide-badge"
    aria-haspopup="dialog"
    class="hover:bg-secondary/80 shrink-0 cursor-pointer"
    @click="help.openTopic(props.topic, props.step)"
  >
    <CircleHelpIcon data-icon="inline-start" aria-hidden="true" />
    {{ label }}
  </Badge>
</template>
