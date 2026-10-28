<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Music, Pause, Play, Volume2, VolumeX } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/formatDuration";
import { previewExtension } from "@/shared/previewFormats";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const audio = useTemplateRef<HTMLAudioElement>("audio");

const playing = ref(false);
const muted = ref(false);
const duration = ref(0);
const position = ref([0]);
/** While the thumb is dragged, playback keeps going but the slider holds still. */
const seeking = ref(false);
const format = computed(() => previewExtension(props.filePath).toUpperCase());

function loaded(): void {
  const element = audio.value;
  if (!element) return;
  duration.value = Number.isFinite(element.duration) ? element.duration : 0;
  emit("metadataChange", { duration: element.duration });
}

function progressed(): void {
  if (!seeking.value) position.value = [audio.value?.currentTime ?? 0];
}

function toggle(): void {
  const element = audio.value;
  if (!element) return;
  if (element.paused) void element.play().catch(() => emit("failed"));
  else element.pause();
}

function seek(value: number[] | undefined): void {
  seeking.value = true;
  position.value = value ?? [0];
}

function commitSeek(value: number[]): void {
  seeking.value = false;
  if (audio.value) audio.value.currentTime = value[0] ?? 0;
}

function toggleMuted(): void {
  if (!audio.value) return;
  audio.value.muted = !audio.value.muted;
  muted.value = audio.value.muted;
}

watch(
  () => props.active,
  (active) => {
    if (!active) audio.value?.pause();
  },
);
onBeforeUnmount(() => audio.value?.pause());
</script>

<template>
  <div
    v-if="preview.kind === 'audio'"
    class="flex h-full min-h-0 items-center justify-center p-6"
  >
    <audio
      ref="audio"
      :src="preview.url"
      preload="metadata"
      @loadedmetadata="loaded"
      @durationchange="loaded"
      @timeupdate="progressed"
      @play="playing = true"
      @pause="playing = false"
      @ended="playing = false"
      @error="emit('failed')"
    />
    <div class="flex w-full max-w-md flex-col gap-5">
      <div class="flex items-center gap-3">
        <div
          class="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
        >
          <Music class="size-5" />
        </div>
        <div class="min-w-0">
          <p class="truncate font-medium">{{ fileName }}</p>
          <p class="text-sm text-muted-foreground">{{ format }}</p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <Button
          size="icon"
          :aria-label="
            t(playing ? 'project.preview.pause' : 'project.preview.play')
          "
          @click="toggle"
        >
          <Pause v-if="playing" />
          <Play v-else />
        </Button>
        <Slider
          class="flex-1"
          :model-value="position"
          :min="0"
          :max="duration || 1"
          :step="0.1"
          :disabled="!duration"
          :aria-label="t('project.preview.seek')"
          @update:model-value="seek"
          @value-commit="commitSeek"
        />
        <span class="text-sm text-muted-foreground tabular-nums">
          {{ formatDuration(position[0] ?? 0) }} /
          {{ formatDuration(duration) }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="
            t(muted ? 'project.preview.unmute' : 'project.preview.mute')
          "
          :aria-pressed="muted"
          @click="toggleMuted"
        >
          <VolumeX v-if="muted" />
          <Volume2 v-else />
        </Button>
      </div>
    </div>
  </div>
</template>
