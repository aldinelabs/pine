<script setup lang="ts">
import { MicIcon, MicOffIcon, Volume2Icon, VolumeOffIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import {
  LIVE_CONTEXT_SOURCES,
  type LiveContextSource,
} from "@/shared/liveContext";

/**
 * The sources Live Context listens to, as a pill of two toggles. At least
 * one stays on: the last one on cannot be turned off.
 */
const sources = defineModel<LiveContextSource[]>({ required: true });
defineProps<{ disabled?: boolean }>();
const { t } = useI18n();

const ICONS = {
  mic: { on: MicIcon, off: MicOffIcon },
  system: { on: Volume2Icon, off: VolumeOffIcon },
} as const;

function toggle(source: LiveContextSource): void {
  const on = sources.value.includes(source);
  if (on && sources.value.length === 1) return;
  sources.value = LIVE_CONTEXT_SOURCES.filter((candidate) =>
    candidate === source ? !on : sources.value.includes(candidate),
  );
}
</script>

<template>
  <div
    role="group"
    :aria-label="t('project.workbench.liveContext.sources')"
    class="bg-muted flex w-full gap-0.5 rounded-2xl p-0.5"
    data-testid="live-context-sources"
  >
    <button
      v-for="source in LIVE_CONTEXT_SOURCES"
      :key="source"
      type="button"
      :disabled="disabled"
      :aria-pressed="sources.includes(source)"
      :data-source="source"
      class="focus-visible:ring-ring/30 text-muted-foreground hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground dark:aria-pressed:bg-input/60 inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[14px] px-2 text-xs font-medium transition-[color,background-color,box-shadow] outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50 aria-pressed:shadow-xs"
      @click="toggle(source)"
    >
      <component
        :is="sources.includes(source) ? ICONS[source].on : ICONS[source].off"
        class="size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span class="truncate">
        {{ t(`project.workbench.liveContext.source.${source}`) }}
      </span>
    </button>
  </div>
</template>
