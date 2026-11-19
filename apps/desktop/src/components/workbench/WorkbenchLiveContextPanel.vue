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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import LiveContextSpeakerChip from "@/components/workbench/LiveContextSpeakerChip.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import {
  LIVE_CONTEXT_LOCALES,
  LIVE_CONTEXT_SOURCES,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextSpeakerKey,
} from "@/shared/liveContext";
import {
  parseSpeakerKey,
  segmentTurns,
  speakerMap,
  speakersOf,
} from "@/shared/liveContextSpeakers";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useLiveContextStore } from "@/stores/liveContext";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";

/**
 * Live Context for the active session: start, pause, or stop transcribing
 * the microphone and system audio, and follow the transcript. The capture is
 * app-wide, so another session's capture shows here as busy. On a new
 * session's page, Start first creates the conversation it captures into.
 */
const { t, locale: uiLocale } = useI18n();
const liveContext = useLiveContextStore();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const tabNavigation = useContentTabNavigation();
const contentTabsStore = useContentTabsStore();

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
/** The new-session tab in front, which Start turns into a conversation. */
const draftTab = computed(() => {
  const tab = tabNavigation.activeSessionTab.value;
  return !target.value && tab?.state === "draft" ? tab : undefined;
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

const speakers = computed(() =>
  target.value
    ? liveContext.speakersOf(target.value.sessionId)
    : { names: {}, merges: {} },
);
/** Pine's own merges and the user's, together. */
const merges = computed(() => speakerMap(speakers.value));

function speakerLabel(speaker: LiveContextSpeakerKey): string {
  return (
    speakers.value.names[speaker] ??
    t("project.workbench.liveContext.speakers.numbered", {
      n: parseSpeakerKey(speaker).speaker,
    })
  );
}

/** Everyone heard so far, after merges, for the merge menu. */
const knownSpeakers = computed(() =>
  speakersOf([...segments.value, ...pending.value], merges.value).map(
    (speaker) => ({ speaker, label: speakerLabel(speaker) }),
  ),
);

/**
 * Each segment as rows: one per speaker turn, each starting with who
 * speaks. Without speaker labels a segment is one row, labeled by source;
 * a labeled segment whose voice is not known yet shows "?".
 */
function rowsOf(segment: LiveContextSegment) {
  const labeled = Boolean(segment.turns?.length);
  return segmentTurns(segment, merges.value).map((piece, index) => ({
    key: `${segment.id}-${index}`,
    speaker: piece.speaker,
    overlap: piece.overlap,
    unknown: labeled && !piece.speaker,
    provisional: !segment.final || piece.provisional === true,
    text: piece.text,
  }));
}

function othersThan(speaker: LiveContextSpeakerKey) {
  return knownSpeakers.value.filter((known) => known.speaker !== speaker);
}

function rename(speaker: LiveContextSpeakerKey, name: string): void {
  const next = target.value;
  if (next) void run(() => liveContext.renameSpeaker(next, speaker, name));
}

function merge(from: LiveContextSpeakerKey, into: LiveContextSpeakerKey): void {
  const next = target.value;
  if (next) void run(() => liveContext.mergeSpeakers(next, from, into));
}

function updateIdentifySpeakers(value: unknown): void {
  liveContext.identifySpeakers = value === true;
}

const languageNames = computed(
  () => new Intl.DisplayNames([uiLocale.value], { type: "language" }),
);

const stateLabel = computed(() => {
  switch (status.value.state) {
    case "preparing":
      return t("project.workbench.liveContext.state.preparing");
    case "downloading":
      return t(
        status.value.download === "speakers"
          ? "project.workbench.liveContext.state.downloadingSpeakers"
          : "project.workbench.liveContext.state.downloading",
        { percent: Math.round((status.value.downloadProgress ?? 0) * 100) },
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
  if (sources.value.length === 0) return;
  const next = target.value;
  if (next) {
    void run(() => liveContext.start(next, sources.value, locale.value));
    return;
  }
  const draft = draftTab.value;
  if (draft) void run(() => startInNewSession(draft.id, draft.projectId));
}

/**
 * Create the conversation the way the composer's first message does, show
 * it in the draft's tab, then capture into it. A failed creation leaves the
 * draft as it was and starts nothing.
 */
async function startInNewSession(
  tabId: string,
  projectId: string,
): Promise<void> {
  const opened = await projectStore.ensureOpen(projectId);
  if (!opened.opened) throw new Error("The project is open elsewhere.");
  // The approval mode the draft's composer would send its first message with.
  const session = await sessionStore.createLiveContextSession(
    projectId,
    contentTabsStore.draftApprovalModeFor(tabId),
  );
  tabNavigation.bindSession(tabId, session);
  await liveContext.start(
    { projectId, sessionId: session.id },
    sources.value,
    locale.value,
  );
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
    <template v-else-if="target || draftTab">
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
      <div
        v-if="!isHere && !isElsewhere && status.speakersAvailable"
        class="flex flex-col gap-1 px-1"
      >
        <div class="flex items-center gap-2">
          <Switch
            id="live-context-identify-speakers"
            :model-value="liveContext.identifySpeakers"
            data-testid="live-context-identify-speakers"
            @update:model-value="updateIdentifySpeakers"
          />
          <Label for="live-context-identify-speakers" class="text-sm">
            {{ t("project.workbench.liveContext.speakers.identify") }}
          </Label>
        </div>
        <p class="text-muted-foreground text-xs">
          {{ t("project.workbench.liveContext.speakers.note") }}
        </p>
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
        v-if="isHere && status.speakersDegraded"
        class="text-muted-foreground px-1 text-xs"
        data-testid="live-context-speakers-degraded"
      >
        {{
          t(
            `project.workbench.liveContext.speakers.degraded.${status.speakersDegraded}`,
          )
        }}
      </p>
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
        {{
          status.lastError.code === "speaker_models_failed" ||
          status.lastError.code === "speakers_unavailable"
            ? t("project.workbench.liveContext.speakers.failed", {
                message: status.lastError.message,
              })
            : status.lastError.message
        }}
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
          class="flex flex-col gap-1"
        >
          <template v-for="(row, index) in rowsOf(segment)" :key="row.key">
            <span
              class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs tabular-nums"
            >
              <template v-if="row.speaker">
                <LiveContextSpeakerChip
                  :speaker="row.speaker"
                  :label="speakerLabel(row.speaker)"
                  :others="othersThan(row.speaker)"
                  :provisional="row.provisional"
                  @rename="(name) => row.speaker && rename(row.speaker, name)"
                  @merge="(into) => row.speaker && merge(row.speaker, into)"
                />
                <template v-if="row.overlap">
                  <span aria-hidden="true">+</span>
                  <LiveContextSpeakerChip
                    :speaker="row.overlap"
                    :label="speakerLabel(row.overlap)"
                    :others="othersThan(row.overlap)"
                    :provisional="row.provisional"
                    @rename="(name) => row.overlap && rename(row.overlap, name)"
                    @merge="(into) => row.overlap && merge(row.overlap, into)"
                  />
                </template>
              </template>
              <span
                v-else-if="row.unknown"
                class="px-1 font-medium"
                :title="t('project.workbench.liveContext.speakers.unknown')"
                data-testid="live-context-speaker-unknown"
                >?</span
              >
              <template v-else>
                {{
                  t(`project.workbench.liveContext.speaker.${segment.source}`)
                }}
              </template>
              <template v-if="index === 0"
                >· {{ time(segment.start) }}</template
              >
              <span
                v-if="index === 0 && segment.echo"
                data-testid="live-context-echo"
                >· {{ t("project.workbench.liveContext.speakers.echo") }}</span
              >
            </span>
            <span
              :class="
                !segment.final || segment.echo
                  ? 'text-muted-foreground'
                  : undefined
              "
              class="select-text"
            >
              {{ row.text }}
            </span>
          </template>
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
