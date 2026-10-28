<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { Spinner } from "@/components/ui/spinner";
import type { DrawioPage } from "@/lib/drawio";
import { previewExtension } from "@/shared/previewFormats";
import { useAppearanceStore } from "@/stores/appearance";
import PreviewPager from "./PreviewPager.vue";
import { readPreviewText } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";
import ZoomableImage from "./ZoomableImage.vue";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const appearance = useAppearanceStore();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const kind = computed(() => {
  const extension = previewExtension(props.filePath);
  if (extension === "excalidraw") return "excalidraw";
  if (extension === "mermaid" || extension === "mmd") return "mermaid";
  return "drawio";
});
const source = shallowRef<string>();
const pages = shallowRef<DrawioPage[]>([]);
const page = ref(1);
const image = ref<string>();
const reading = new AbortController();
let generation = 0;

async function svgFor(text: string): Promise<string> {
  if (kind.value === "excalidraw") {
    const { renderExcalidraw } = await import("@/lib/excalidraw");
    return renderExcalidraw(text);
  }
  if (kind.value === "mermaid") {
    const { renderMermaid } = await import("@/lib/mermaid");
    return renderMermaid(text, appearance.colorScheme);
  }
  const { readDrawioPages, renderDrawioPage } = await import("@/lib/drawio");
  if (!pages.value.length) pages.value = await readDrawioPages(text);
  const current = pages.value[page.value - 1] ?? pages.value[0];
  return renderDrawioPage(current);
}

async function render(): Promise<void> {
  const current = ++generation;
  try {
    source.value ??= await readPreviewText(props.preview, reading.signal);
    const svg = await svgFor(source.value);
    if (current !== generation) return;
    if (image.value) URL.revokeObjectURL(image.value);
    image.value = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    if (pages.value.length > 1)
      emit("metadataChange", { pageCount: pages.value.length });
  } catch (error) {
    if (reading.signal.aborted || current !== generation) return;
    console.error("Failed to render the diagram.", error);
    emit("failed");
  }
}

onMounted(() => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
    toolbar: kind.value === "drawio",
  });
  void render();
});
watch(page, () => void render());
// Mermaid draws in the app's theme.
watch(
  () => appearance.colorScheme,
  () => {
    if (kind.value === "mermaid") void render();
  },
);
onBeforeUnmount(() => {
  reading.abort();
  if (image.value) URL.revokeObjectURL(image.value);
});

defineExpose({ fitWidth: () => stage.value?.fitWidth() });
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && pages.length > 1" :to="toolbar">
      <PreviewPager v-model:page="page" :page-count="pages.length" />
      <span class="truncate text-sm text-muted-foreground">{{
        pages[page - 1]?.name
      }}</span>
    </Teleport>
    <ZoomableImage
      v-if="image"
      ref="stage"
      :src="image"
      :alt="fileName"
      :zoom="zoom"
      :compact="compact"
      :max-fit="2"
      :checkerboard="false"
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
