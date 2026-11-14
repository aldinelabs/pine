<script setup lang="ts">
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  Maximize,
  MessageSquareText,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Repeat,
  Volume2,
  VolumeX,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatTimeSpan, formatTimestamp } from "@/lib/annotationLocation";
import {
  PLAYBACK_RATES,
  SHORTCUT_SEEK,
  clampTime,
  mediaShortcut,
  normalizeSpan,
  type MediaShortcut,
  type TimeSpan,
} from "./mediaControls";
import PreviewMediaButton from "./PreviewMediaButton.vue";
import PreviewMediaTimeline, {
  type TimelineComment,
} from "./PreviewMediaTimeline.vue";
import { previewAnnotationsKey } from "./previewRenderer";

const props = defineProps<{
  media: HTMLMediaElement | null;
  kind: "audio" | "video";
  /** The preview's tab is shown; shortcuts only work then. */
  active: boolean;
  /** The player: shortcuts work while focus is in it or nowhere. */
  scope: HTMLElement | null;
  /** What goes full screen, so the controls come along. */
  fullscreenTarget?: HTMLElement | null;
}>();
const emit = defineEmits<{ failed: [] }>();

const { t } = useI18n();
const annotations = inject(previewAnnotationsKey, undefined);
const timeline =
  useTemplateRef<InstanceType<typeof PreviewMediaTimeline>>("timeline");

const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const muted = ref(false);
const volume = ref(1);
const rate = ref(1);
const loop = ref(false);
const fullscreen = ref(false);
const pictureInPicture = ref(false);
const markIn = ref<number>();
const markOut = ref<number>();

const canFullscreen = computed(
  () =>
    props.kind === "video" &&
    Boolean(document.fullscreenEnabled && props.fullscreenTarget),
);
const canPictureInPicture = computed(
  () => props.kind === "video" && Boolean(document.pictureInPictureEnabled),
);
const annotatable = computed(
  () => Boolean(annotations?.enabled.value) && duration.value > 0,
);

const comments = computed<TimelineComment[]>(() =>
  (annotations?.annotations.value ?? []).flatMap((annotation) =>
    annotation.anchor.kind === "time"
      ? [
          {
            id: annotation.id,
            start: annotation.anchor.start,
            end: annotation.anchor.end,
            comment: annotation.comment,
          },
        ]
      : [],
  ),
);
const draft = computed<TimeSpan | undefined>(() => {
  const shape = annotations?.draft.value;
  return shape?.kind === "time"
    ? { start: shape.start, end: shape.end }
    : undefined;
});
const marked = computed(
  () => markIn.value !== undefined || markOut.value !== undefined,
);
/** The marked span, its missing end at the playhead; or the playhead. */
const commentSpan = computed(() =>
  normalizeSpan(
    markIn.value ?? currentTime.value,
    markOut.value ?? currentTime.value,
  ),
);

function sync(): void {
  const media = props.media;
  if (!media) return;
  playing.value = !media.paused && !media.ended;
  currentTime.value = media.currentTime;
  duration.value = Number.isFinite(media.duration) ? media.duration : 0;
  muted.value = media.muted;
  volume.value = media.volume;
  rate.value = media.playbackRate;
  loop.value = media.loop;
}

const MEDIA_EVENTS = [
  "loadedmetadata",
  "durationchange",
  "timeupdate",
  "play",
  "pause",
  "ended",
  "seeked",
  "volumechange",
  "ratechange",
] as const;

function syncPictureInPicture(): void {
  pictureInPicture.value =
    Boolean(props.media) && document.pictureInPictureElement === props.media;
}

watch(
  () => props.media,
  (media, _previous, onCleanup) => {
    if (!media) return;
    sync();
    for (const name of MEDIA_EVENTS) media.addEventListener(name, sync);
    media.addEventListener("enterpictureinpicture", syncPictureInPicture);
    media.addEventListener("leavepictureinpicture", syncPictureInPicture);
    onCleanup(() => {
      for (const name of MEDIA_EVENTS) media.removeEventListener(name, sync);
      media.removeEventListener("enterpictureinpicture", syncPictureInPicture);
      media.removeEventListener("leavepictureinpicture", syncPictureInPicture);
    });
  },
  { immediate: true },
);

function togglePlay(): void {
  const media = props.media;
  if (!media) return;
  if (media.paused || media.ended)
    void media.play()?.catch(() => emit("failed"));
  else media.pause();
}

function seek(time: number): void {
  const media = props.media;
  if (!media) return;
  media.currentTime = clampTime(time, duration.value);
  currentTime.value = media.currentTime;
}

function toggleMuted(): void {
  const media = props.media;
  if (media) media.muted = !media.muted;
}

function setVolume(value: number[] | undefined): void {
  const media = props.media;
  if (!media) return;
  const next = (value?.[0] ?? 0) / 100;
  media.volume = next;
  media.muted = next === 0;
}

function setRate(value: unknown): void {
  const next = Number(value);
  const media = props.media;
  if (media && Number.isFinite(next)) media.playbackRate = next;
}

function toggleLoop(): void {
  const media = props.media;
  if (!media) return;
  media.loop = !media.loop;
  loop.value = media.loop;
}

function toggleFullscreen(): void {
  const target = props.fullscreenTarget;
  if (!canFullscreen.value || !target) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void target.requestFullscreen().catch(() => undefined);
}

function syncFullscreen(): void {
  fullscreen.value =
    Boolean(props.fullscreenTarget) &&
    document.fullscreenElement === props.fullscreenTarget;
}

function togglePictureInPicture(): void {
  const media = props.media;
  if (!canPictureInPicture.value || !(media instanceof HTMLVideoElement))
    return;
  if (document.pictureInPictureElement)
    void document.exitPictureInPicture().catch(() => undefined);
  else void media.requestPictureInPicture().catch(() => undefined);
}

function clearMarks(): void {
  markIn.value = undefined;
  markOut.value = undefined;
}

/** Opens the comment box for a span of the recording, under its timeline span. */
function compose(span: TimeSpan): void {
  if (!annotations || !annotatable.value) return;
  props.media?.pause();
  clearMarks();
  annotations.compose({
    shape: { kind: "time", start: span.start, end: span.end },
    text: formatTimeSpan(span.start, span.end),
    rect: () => timeline.value?.rectFor(span) ?? new DOMRect(),
  });
}

function mark(point: "in" | "out"): void {
  if (!annotatable.value) return;
  const time = currentTime.value;
  if (point === "in") markIn.value = time;
  else markOut.value = time;
  if (markIn.value !== undefined && markOut.value !== undefined)
    compose(normalizeSpan(markIn.value, markOut.value));
}

/** Runs a shortcut; false when it does nothing here, so the key goes on. */
function run(shortcut: MediaShortcut): boolean {
  if (!props.media) return false;
  const delta = SHORTCUT_SEEK[shortcut];
  if (delta !== undefined) {
    seek(props.media.currentTime + delta);
    return true;
  }
  switch (shortcut) {
    case "toggle":
      togglePlay();
      return true;
    case "mute":
      toggleMuted();
      return true;
    case "fullscreen":
      if (!canFullscreen.value) return false;
      toggleFullscreen();
      return true;
    case "markIn":
    case "markOut":
      if (!annotatable.value) return false;
      mark(shortcut === "markIn" ? "in" : "out");
      return true;
    case "clearMarks":
      if (!marked.value) return false;
      clearMarks();
      return true;
    default:
      return false;
  }
}

function handleKey(event: KeyboardEvent): void {
  if (!props.active) return;
  const shortcut = mediaShortcut(event, props.scope);
  if (shortcut && run(shortcut)) event.preventDefault();
}

onMounted(() => {
  window.addEventListener("keydown", handleKey);
  document.addEventListener("fullscreenchange", syncFullscreen);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKey);
  document.removeEventListener("fullscreenchange", syncFullscreen);
});

defineExpose({ togglePlay, toggleFullscreen });
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div
      class="flex w-full flex-col gap-1"
      data-slot="media-controls"
      role="group"
      :aria-label="t('project.preview.media.controls')"
    >
      <PreviewMediaTimeline
        ref="timeline"
        :current-time="currentTime"
        :duration="duration"
        :comments="annotatable ? comments : []"
        :active-id="annotations?.activeId.value"
        :draft="annotatable ? draft : undefined"
        :mark-in="markIn"
        :mark-out="markOut"
        :annotatable="annotatable"
        @seek="seek"
        @select="annotations?.select($event)"
        @mark="compose"
      />
      <div class="flex min-w-0 items-center gap-0.5">
        <PreviewMediaButton
          :label="t(playing ? 'project.preview.pause' : 'project.preview.play')"
          shortcut="K"
          @click="togglePlay"
        >
          <Pause v-if="playing" />
          <Play v-else />
        </PreviewMediaButton>
        <span
          class="ml-1 truncate text-xs text-muted-foreground tabular-nums"
          data-slot="media-time"
        >
          {{ formatTimestamp(currentTime) }} / {{ formatTimestamp(duration) }}
        </span>
        <div class="flex-1" />
        <PreviewMediaButton
          v-if="annotatable"
          :label="
            marked
              ? t('project.preview.media.commentSpan', {
                  span: formatTimeSpan(commentSpan.start, commentSpan.end),
                })
              : t('project.preview.media.commentMoment')
          "
          :hint="t('project.preview.media.commentHint')"
          @click="compose(commentSpan)"
        >
          <MessageSquareText />
        </PreviewMediaButton>
        <PreviewMediaButton
          :label="t('project.preview.media.loop')"
          :pressed="loop"
          @click="toggleLoop"
        >
          <Repeat />
        </PreviewMediaButton>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="px-2 text-xs tabular-nums"
              :aria-label="t('project.preview.media.speed')"
            >
              {{ rate }}×
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-28">
            <DropdownMenuLabel>{{
              t("project.preview.media.speed")
            }}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              :model-value="String(rate)"
              @update:model-value="setRate"
            >
              <DropdownMenuRadioItem
                v-for="option in PLAYBACK_RATES"
                :key="option"
                :value="String(option)"
                class="tabular-nums"
              >
                {{ option }}×
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <PreviewMediaButton
          :label="t(muted ? 'project.preview.unmute' : 'project.preview.mute')"
          shortcut="M"
          @click="toggleMuted"
        >
          <VolumeX v-if="muted" />
          <Volume2 v-else />
        </PreviewMediaButton>
        <Slider
          class="mr-1 w-20 shrink-0"
          :model-value="[muted ? 0 : Math.round(volume * 100)]"
          :min="0"
          :max="100"
          :step="1"
          :aria-label="t('project.preview.media.volume')"
          @update:model-value="setVolume"
        />
        <PreviewMediaButton
          v-if="canPictureInPicture"
          :label="
            t(
              pictureInPicture
                ? 'project.preview.media.exitPictureInPicture'
                : 'project.preview.media.pictureInPicture',
            )
          "
          @click="togglePictureInPicture"
        >
          <PictureInPicture2 />
        </PreviewMediaButton>
        <PreviewMediaButton
          v-if="canFullscreen"
          :label="
            t(
              fullscreen
                ? 'project.preview.media.exitFullscreen'
                : 'project.preview.media.fullscreen',
            )
          "
          shortcut="F"
          @click="toggleFullscreen"
        >
          <Minimize v-if="fullscreen" />
          <Maximize v-else />
        </PreviewMediaButton>
      </div>
    </div>
  </TooltipProvider>
</template>
