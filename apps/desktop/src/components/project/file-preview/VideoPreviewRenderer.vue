<script setup lang="ts">
import { inject, onBeforeUnmount, useTemplateRef, watch } from "vue";
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
const video = useTemplateRef<HTMLVideoElement>("video");
const controls =
  useTemplateRef<InstanceType<typeof PreviewMediaControls>>("controls");

function videoLoaded(): void {
  if (!video.value) return;
  emit("metadataChange", {
    width: video.value.videoWidth,
    height: video.value.videoHeight,
    duration: video.value.duration,
  });
  // Time comments are made on the timeline once its length is known.
  if (annotations) emit("capabilitiesChange", { annotateTime: true });
}

/** Shows a time comment: its first frame, paused. */
function revealAnnotation({ shape }: AnnotationRevealRequest): void {
  const element = video.value;
  if (!element || shape?.kind !== "time") return;
  element.pause();
  element.currentTime = shape.start;
}

watch(
  () => props.active,
  (active) => {
    if (!active) video.value?.pause();
  },
);
onBeforeUnmount(() => video.value?.pause());

defineExpose({ revealAnnotation });
</script>

<template>
  <div
    v-if="preview.kind === 'video'"
    ref="root"
    tabindex="-1"
    class="flex h-full min-h-0 flex-col bg-background outline-none"
  >
    <div
      class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6 pb-3"
    >
      <video
        ref="video"
        :src="preview.url"
        :aria-label="fileName"
        preload="metadata"
        class="max-h-full max-w-full rounded-lg"
        @loadedmetadata="videoLoaded"
        @click="controls?.togglePlay()"
        @dblclick="controls?.toggleFullscreen()"
        @error="emit('failed')"
      />
    </div>
    <div class="shrink-0 px-4 pb-3">
      <PreviewMediaControls
        ref="controls"
        kind="video"
        :media="video"
        :active="active"
        :scope="root"
        :fullscreen-target="root"
        @failed="emit('failed')"
      />
    </div>
  </div>
</template>
