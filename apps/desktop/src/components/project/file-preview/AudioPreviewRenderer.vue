<script setup lang="ts">
import { computed, inject, onBeforeUnmount, useTemplateRef, watch } from "vue";
import { Music } from "@lucide/vue";
import { previewExtension } from "@/shared/previewFormats";
import PreviewMediaControls from "./PreviewMediaControls.vue";
import {
  previewAnnotationsKey,
  type AnnotationRevealRequest,
  type PreviewRendererEvents,
  type PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const annotations = inject(previewAnnotationsKey, undefined);
const root = useTemplateRef<HTMLElement>("root");
const audio = useTemplateRef<HTMLAudioElement>("audio");
const format = computed(() => previewExtension(props.filePath).toUpperCase());

function loaded(): void {
  const element = audio.value;
  if (!element) return;
  emit("metadataChange", { duration: element.duration });
  // Time comments are made on the timeline once its length is known.
  if (annotations) emit("capabilitiesChange", { annotateTime: true });
}

/** Shows a time comment: its start, paused. */
function revealAnnotation({ shape }: AnnotationRevealRequest): void {
  const element = audio.value;
  if (!element || shape?.kind !== "time") return;
  element.pause();
  element.currentTime = shape.start;
}

watch(
  () => props.active,
  (active) => {
    if (!active) audio.value?.pause();
  },
);
onBeforeUnmount(() => audio.value?.pause());

defineExpose({ revealAnnotation });
</script>

<template>
  <div
    v-if="preview.kind === 'audio'"
    ref="root"
    tabindex="-1"
    class="flex h-full min-h-0 items-center justify-center p-6 outline-none"
  >
    <audio
      ref="audio"
      :src="preview.url"
      preload="metadata"
      @loadedmetadata="loaded"
      @durationchange="loaded"
      @error="emit('failed')"
    />
    <div class="flex w-full max-w-xl flex-col gap-4">
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
      <PreviewMediaControls
        kind="audio"
        :media="audio"
        :active="active"
        :scope="root"
        @failed="emit('failed')"
      />
    </div>
  </div>
</template>
