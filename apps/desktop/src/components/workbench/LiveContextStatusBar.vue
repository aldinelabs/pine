<script setup lang="ts">
import {
  MicIcon,
  PauseIcon,
  PlayIcon,
  SquareIcon,
  Volume2Icon,
} from "@lucide/vue";
import { useIntervalFn } from "@vueuse/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { LiveContextStatus } from "@/shared/liveContext";
import { formatDuration } from "@/lib/formatDuration";

/**
 * The capture in this conversation: whether it is live, for how long, what
 * it hears, and Pause/Resume and Stop.
 */
const props = defineProps<{
  status: LiveContextStatus;
  /** Listening time so far, paused time left out. */
  elapsedAt: (now: number) => number | undefined;
  busy?: boolean;
}>();
const emit = defineEmits<{ pause: []; resume: []; stop: [] }>();
const { t, locale: uiLocale } = useI18n();
const now = ref(Date.now());
useIntervalFn(() => (now.value = Date.now()), 1000);

const state = computed(() => props.status.state);
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

const language = computed(() => {
  const locale = props.status.locale;
  if (!locale) return undefined;
  return (
    new Intl.DisplayNames([uiLocale.value], { type: "language" }).of(locale) ??
    locale
  );
});
</script>

<template>
  <div
    class="bg-muted/60 flex flex-col gap-2 rounded-2xl p-1.5 pl-3"
    :data-state="state"
    data-testid="live-context-status"
  >
    <div class="flex min-h-8 items-center gap-2.5">
      <span
        class="relative flex size-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <template v-if="state === 'listening'">
          <span
            class="absolute size-2.5 animate-ping rounded-full bg-red-500/60 [animation-duration:2s]"
          />
          <span class="relative size-2.5 rounded-full bg-red-500" />
        </template>
        <span
          v-else-if="state === 'paused'"
          class="size-2.5 rounded-full bg-amber-500"
        />
        <Spinner v-else class="text-muted-foreground size-3.5" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="flex items-baseline gap-1.5 text-sm leading-5">
          <span
            class="truncate font-medium"
            :title="label"
            data-testid="live-context-state"
          >
            {{ label }}
          </span>
          <span
            v-if="elapsed && (state === 'listening' || state === 'paused')"
            class="text-muted-foreground font-mono text-xs tabular-nums"
            data-testid="live-context-elapsed"
            >{{ elapsed }}</span
          >
        </span>
        <span
          class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs leading-4"
        >
          <MicIcon
            v-if="status.sources.includes('mic')"
            class="size-3 shrink-0"
            :aria-label="t('project.workbench.liveContext.source.mic')"
          />
          <Volume2Icon
            v-if="status.sources.includes('system')"
            class="size-3 shrink-0"
            :aria-label="t('project.workbench.liveContext.source.system')"
          />
          <span v-if="language" class="truncate">{{ language }}</span>
        </span>
      </div>
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
        size="sm"
        variant="outline"
        data-testid="live-context-stop"
        :disabled="busy || state === 'stopping'"
        @click="emit('stop')"
      >
        <SquareIcon
          data-icon="inline-start"
          class="size-3 fill-current"
          aria-hidden="true"
        />
        {{ t("project.workbench.liveContext.stop") }}
      </Button>
    </div>
    <div
      v-if="state === 'downloading'"
      class="mr-1.5 mb-1 flex items-center gap-2"
    >
      <Progress
        :model-value="percent"
        class="h-1 flex-1"
        data-testid="live-context-download"
      />
      <span class="text-muted-foreground w-8 text-right text-xs tabular-nums"
        >{{ percent }}%</span
      >
    </div>
  </div>
</template>
