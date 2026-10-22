<script setup lang="ts">
import { onBeforeUnmount, useTemplateRef, watch } from "vue";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const video = useTemplateRef<HTMLVideoElement>("video");

function videoLoaded(): void {
  if (!video.value) return;
  emit("metadataChange", {
    width: video.value.videoWidth,
    height: video.value.videoHeight,
    duration: video.value.duration,
  });
}

watch(
  () => props.active,
  (active) => {
    if (!active) video.value?.pause();
  },
);
onBeforeUnmount(() => video.value?.pause());
</script>

<template>
  <div
    v-if="preview.kind === 'video'"
    class="scroll-fade flex h-full min-h-0 items-center justify-center overflow-auto p-6"
  >
    <video
      ref="video"
      :src="preview.url"
      :aria-label="fileName"
      controls
      preload="metadata"
      class="max-h-full max-w-full rounded-lg"
      @loadedmetadata="videoLoaded"
      @error="emit('failed')"
    />
  </div>
</template>
