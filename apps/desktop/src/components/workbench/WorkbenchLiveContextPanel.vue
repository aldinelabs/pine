<script setup lang="ts">
import { MicIcon, PauseIcon, PlayIcon, SquareIcon } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LIVE_CONTEXT_LOCALES,
  LIVE_CONTEXT_SOURCES,
  type LiveContextSource,
} from "@/shared/liveContext";
import { useLiveContextStore } from "@/stores/liveContext";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/**
 * Live Context for the active session: start, pause, or stop transcribing
 * the microphone and system audio, and follow the transcript. The capture is
 * app-wide, so another session's capture shows here as busy.
 */
const { t, locale: uiLocale } = useI18n();
const liveContext = useLiveContextStore();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();

const sources = ref<LiveContextSource[]>(["mic", "system"]);
const locale = ref<string>(
  LIVE_CONTEXT_LOCALES.find((option) =>
    option.startsWith(navigator.language.slice(0, 2)),
  ) ?? "en-US",
);
const isBusy = ref(false);

const target = computed(() => {
  const sessionId = sessionStore.activeSession?.id;
  if (!sessionId) return undefined;
  const projectId =
    sessionStore.projectOf(sessionId) ?? projectStore.currentProjectId;
  return projectId ? { projectId, sessionId } : undefined;
});
const status = computed(() => liveContext.status);
const isHere = computed(
  () =>
    liveContext.isCapturing &&
    status.value.sessionId === target.value?.sessionId,
);
const isElsewhere = computed(() => liveContext.isCapturing && !isHere.value);
const segments = computed(() =>
  target.value ? liveContext.segmentsOf(target.value.sessionId) : [],
);
const pending = computed(() =>
  target.value ? liveContext.volatileOf(target.value.sessionId) : [],
);

const languageNames = computed(
  () => new Intl.DisplayNames([uiLocale.value], { type: "language" }),
);

const stateLabel = computed(() => {
  switch (status.value.state) {
    case "preparing":
      return t("project.workbench.liveContext.state.preparing");
    case "downloading":
      return t("project.workbench.liveContext.state.downloading", {
        percent: Math.round((status.value.downloadProgress ?? 0) * 100),
      });
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

watch(
  target,
  (next) => {
    if (next)
      void liveContext.load(next).catch((error: unknown) =>
        handleError(error, {
          id: "live-context.load",
          title: t("project.workbench.liveContext.loadFailed"),
        }),
      );
  },
  { immediate: true },
);

async function run(action: () => Promise<void>): Promise<void> {
  if (isBusy.value) return;
  isBusy.value = true;
  try {
    await action();
  } catch (error) {
    handleError(error, {
      id: "live-context.action",
      title: t("project.workbench.liveContext.actionFailed"),
    });
  } finally {
    isBusy.value = false;
  }
}

function start(): void {
  const next = target.value;
  if (!next || sources.value.length === 0) return;
  void run(() => liveContext.start(next, sources.value, locale.value));
}

function updateSources(value: unknown): void {
  if (Array.isArray(value))
    sources.value = LIVE_CONTEXT_SOURCES.filter((source) =>
      value.includes(source),
    );
}

function updateLocale(value: unknown): void {
  if (typeof value === "string") locale.value = value;
}

function time(ms: number): string {
  return new Date(ms).toLocaleTimeString(uiLocale.value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Follow new text while the user is at the bottom.
const list = ref<HTMLElement | null>(null);
watch(
  () => [segments.value.length, pending.value.map(({ text }) => text).join()],
  async () => {
    const scroller = list.value?.closest(".overflow-y-auto");
    if (!scroller) return;
    const atBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 48;
    await nextTick();
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  },
);
</script>

<template>
  <div
    class="flex min-h-full flex-col gap-3 px-(--workbench-inset) pb-(--workbench-inset)"
    data-testid="workbench-live-context"
  >
    <p
      v-if="!liveContext.available"
      class="text-muted-foreground px-1 text-sm"
      data-testid="live-context-unavailable"
    >
      {{
        t(
          `project.workbench.liveContext.unavailable.${status.unavailableReason ?? "platform"}`,
        )
      }}
    </p>
    <p v-else-if="!target" class="text-muted-foreground px-1 text-sm">
      {{ t("project.workbench.liveContext.noSession") }}
    </p>
    <template v-else>
      <div
        v-if="isElsewhere"
        class="flex items-center gap-2 px-1 text-sm"
        data-testid="live-context-elsewhere"
      >
        <span class="text-muted-foreground min-w-0 flex-1">
          {{ t("project.workbench.liveContext.elsewhere") }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="isBusy"
          @click="run(liveContext.stop)"
        >
          <SquareIcon data-icon="inline-start" aria-hidden="true" />
          {{ t("project.workbench.liveContext.stop") }}
        </Button>
      </div>
      <div v-else-if="!isHere" class="flex flex-wrap items-center gap-2 px-1">
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          :model-value="sources"
          :aria-label="t('project.workbench.liveContext.sources')"
          @update:model-value="updateSources"
        >
          <ToggleGroupItem
            v-for="source in LIVE_CONTEXT_SOURCES"
            :key="source"
            :value="source"
          >
            {{ t(`project.workbench.liveContext.source.${source}`) }}
          </ToggleGroupItem>
        </ToggleGroup>
        <Select :model-value="locale" @update:model-value="updateLocale">
          <SelectTrigger
            size="sm"
            class="w-fit"
            :aria-label="t('project.workbench.liveContext.language')"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem
                v-for="option in LIVE_CONTEXT_LOCALES"
                :key="option"
                :value="option"
              >
                {{ languageNames.of(option) ?? option }}
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          data-testid="live-context-start"
          :disabled="isBusy || sources.length === 0"
          @click="start"
        >
          <MicIcon data-icon="inline-start" aria-hidden="true" />
          {{
            segments.length
              ? t("project.workbench.liveContext.resume")
              : t("project.workbench.liveContext.start")
          }}
        </Button>
      </div>
      <div v-else class="flex items-center gap-2 px-1">
        <span
          class="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 text-sm"
        >
          <span
            v-if="status.state === 'listening'"
            class="size-2 shrink-0 animate-pulse rounded-full bg-red-500"
            aria-hidden="true"
          />
          {{ stateLabel }}
        </span>
        <Button
          v-if="status.state === 'paused'"
          variant="outline"
          size="sm"
          :disabled="isBusy"
          @click="run(liveContext.resume)"
        >
          <PlayIcon data-icon="inline-start" aria-hidden="true" />
          {{ t("project.workbench.liveContext.resume") }}
        </Button>
        <Button
          v-else
          variant="outline"
          size="sm"
          :disabled="isBusy || status.state !== 'listening'"
          @click="run(liveContext.pause)"
        >
          <PauseIcon data-icon="inline-start" aria-hidden="true" />
          {{ t("project.workbench.liveContext.pause") }}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="live-context-stop"
          :disabled="isBusy || status.state === 'stopping'"
          @click="run(liveContext.stop)"
        >
          <SquareIcon data-icon="inline-start" aria-hidden="true" />
          {{ t("project.workbench.liveContext.stop") }}
        </Button>
      </div>

      <p
        v-if="isHere && status.systemSilent"
        class="text-muted-foreground px-1 text-xs"
      >
        {{ t("project.workbench.liveContext.systemSilent") }}
      </p>
      <p
        v-if="status.lastError && (isHere || !liveContext.isCapturing)"
        class="text-destructive px-1 text-xs"
        data-testid="live-context-error"
      >
        {{ status.lastError.message }}
      </p>

      <ol
        ref="list"
        class="flex flex-col gap-2 px-1 text-sm"
        data-testid="live-context-transcript"
      >
        <li
          v-for="segment in [...segments, ...pending]"
          :key="segment.id"
          :data-final="segment.final || undefined"
          class="flex flex-col gap-0.5"
        >
          <span class="text-muted-foreground text-xs tabular-nums">
            {{ t(`project.workbench.liveContext.speaker.${segment.source}`) }}
            · {{ time(segment.start) }}
          </span>
          <span
            :class="segment.final ? undefined : 'text-muted-foreground'"
            class="select-text"
          >
            {{ segment.text }}
          </span>
        </li>
      </ol>
      <p
        v-if="!segments.length && !pending.length && !isHere"
        class="text-muted-foreground px-1 text-sm"
      >
        {{ t("project.workbench.liveContext.empty") }}
      </p>
    </template>
  </div>
</template>
