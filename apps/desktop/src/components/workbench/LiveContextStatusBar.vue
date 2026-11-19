<script setup lang="ts">
import { PauseIcon, PlayIcon, SquareIcon } from "@lucide/vue";
import { useIntervalFn } from "@vueuse/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import LiveContextWaveform from "@/components/workbench/LiveContextWaveform.vue";
import type { LiveContextStatus } from "@/shared/liveContext";
import type { LiveContextLevelSample } from "@/stores/liveContext";
import { formatDuration } from "@/lib/formatDuration";

/**
 * The capture in this conversation, as a bar at the foot of the card like
 * the composer: whether it is live and for how long, the last few seconds
 * of sound, and Pause/Resume and Stop.
 */
const props = defineProps<{
  status: LiveContextStatus;
  /** Listening time so far, paused time left out. */
  elapsedAt: (now: number) => number | undefined;
  levels: () => readonly LiveContextLevelSample[];
  busy?: boolean;
}>();
const emit = defineEmits<{ pause: []; resume: []; stop: [] }>();
const { t, locale: uiLocale } = useI18n();
const now = ref(Date.now());
useIntervalFn(() => (now.value = Date.now()), 1000);

const state = computed(() => props.status.state);
const live = computed(
  () => state.value === "listening" || state.value === "paused",
);
const elapsed = computed(() => {
  const ms = props.elapsedAt(now.value);
  return ms === undefined ? undefined : formatDuration(ms / 1000);
});
const percent = computed(() =>
  Math.round((props.status.downloadProgress ?? 0) * 100),
);

const label = computed(() => {
  switch (state.value) {
    case "preparing":
      return t("project.workbench.liveContext.state.preparing");
    case "downloading":
      return t(
        props.status.download === "speakers"
          ? "project.workbench.liveContext.state.downloadingSpeakers"
          : "project.workbench.liveContext.state.downloading",
      );
    case "listening":
      return t("project.workbench.liveContext.state.listening");
    case "paused":
      return t("project.workbench.liveContext.state.paused");
    case "stopping":
      return t("project.workbench.liveContext.state.stopping");
    default:
      return "";
  }
});

/** What it hears, for the bar's tooltip. */
const details = computed(() => {
  const parts = props.status.sources.map((source) =>
    t(`project.workbench.liveContext.source.${source}`),
  );
  const locale = props.status.locale;
  if (locale)
    parts.push(
      new Intl.DisplayNames([uiLocale.value], { type: "language" }).of(
        locale,
      ) ?? locale,
    );
  return parts.join(" · ");
});
</script>

<template>
  <div
    class="bg-muted flex flex-col rounded-(--workbench-inner-radius)"
    :data-state="state"
    data-testid="live-context-status"
  >
    <div class="flex h-8 min-w-0 items-center gap-2 pr-0.5 pl-3">
      <span
        class="flex size-3 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <span
          v-if="state === 'listening'"
          class="live-context-dot size-2 rounded-full bg-red-500"
        />
        <span
          v-else-if="state === 'paused'"
          class="size-2 rounded-full bg-amber-500"
        />
        <Spinner v-else class="text-muted-foreground size-3" />
      </span>
      <span
        class="flex shrink-0 items-baseline gap-1.5 text-sm"
        :title="details || undefined"
      >
        <!-- While listening the red dot and the time say it, so the
             waveform gets the room; screen readers still hear it. -->
        <span
          class="max-w-40 truncate font-medium"
          :class="state === 'listening' && 'sr-only'"
          data-testid="live-context-state"
          >{{ label }}</span
        >
        <span
          v-if="elapsed && live"
          class="text-muted-foreground text-xs tabular-nums"
          data-testid="live-context-elapsed"
          >{{ elapsed }}</span
        >
      </span>
      <LiveContextWaveform
        v-if="live"
        class="h-6 min-w-0 flex-1"
        :history="levels"
        :sources="status.sources"
        :paused="state === 'paused'"
      />
      <span
        v-else-if="state === 'downloading'"
        class="text-muted-foreground ml-auto text-xs tabular-nums"
        >{{ percent }}%</span
      >
      <div class="ml-auto flex shrink-0 items-center">
        <Button
          v-if="state === 'paused'"
          size="icon-sm"
          variant="ghost"
          data-testid="live-context-resume"
          :disabled="busy"
          :aria-label="t('project.workbench.liveContext.resume')"
          :title="t('project.workbench.liveContext.resume')"
          @click="emit('resume')"
        >
          <PlayIcon aria-hidden="true" />
        </Button>
        <Button
          v-else-if="state === 'listening'"
          size="icon-sm"
          variant="ghost"
          data-testid="live-context-pause"
          :disabled="busy"
          :aria-label="t('project.workbench.liveContext.pause')"
          :title="t('project.workbench.liveContext.pause')"
          @click="emit('pause')"
        >
          <PauseIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          data-testid="live-context-stop"
          :disabled="busy || state === 'stopping'"
          :aria-label="t('project.workbench.liveContext.stop')"
          :title="t('project.workbench.liveContext.stop')"
          @click="emit('stop')"
        >
          <SquareIcon class="size-3 fill-current" aria-hidden="true" />
        </Button>
      </div>
    </div>
    <Progress
      v-if="state === 'downloading'"
      :model-value="percent"
      class="mx-3 mb-2 h-1 w-auto"
      data-testid="live-context-download"
    />
  </div>
</template>

<style scoped>
/* A slow breath rather than a ping: it sits next to the waveform. */
.live-context-dot {
  animation: live-context-dot 2s ease-in-out infinite;
}

@keyframes live-context-dot {
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-context-dot {
    animation: none;
  }
}
</style>
