<script setup lang="ts">
import {
  CheckIcon,
  CircleStopIcon,
  CircleXIcon,
  ListCollapseIcon,
} from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import FirstUseHint from "@/components/help/FirstUseHint.vue";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type { PineCompaction } from "@/shared/sessions";

const props = defineProps<{
  compaction: PineCompaction;
}>();

const { t } = useI18n();
const isRunning = computed(() => props.compaction.status === "running");
const label = computed(() =>
  t(`project.transcript.compaction.${props.compaction.status}`),
);
const labelClass = computed(() => {
  if (isRunning.value) return "shimmer";
  if (props.compaction.status === "error") return "text-destructive";
  return undefined;
});
</script>

<template>
  <Marker
    :aria-live="isRunning ? 'polite' : undefined"
    :data-compaction-status="compaction.status"
  >
    <MarkerIcon>
      <ListCollapseIcon v-if="isRunning" />
      <CheckIcon v-else-if="compaction.status === 'complete'" />
      <CircleStopIcon v-else-if="compaction.status === 'aborted'" />
      <CircleXIcon v-else class="text-destructive" />
    </MarkerIcon>
    <MarkerContent :class="labelClass">{{ label }}</MarkerContent>
  </Marker>
  <FirstUseHint
    v-if="compaction.status === 'complete'"
    id="compaction"
    class="mt-2"
    :text="t('help.hints.compaction')"
    :guide="{ topic: 'context-window', step: 2 }"
  />
</template>
