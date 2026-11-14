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
import { pageTarget, requestedPage } from "./annotationPages";
import { readPreviewText } from "./previewBytes";
import type {
  AnnotationRevealRequest,
  AnnotationTarget,
  PreviewRendererCapabilities,
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
/** The draw.io page the image shows; `page` changes before it renders. */
const shownPage = ref(1);
const loaded = ref(false);
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

let described = false;

/** What the diagram file records, read once its first image is shown. */
async function describe(text: string): Promise<void> {
  try {
    const formats = await import("@/lib/previewProperties/structure");
    const read = {
      drawio: formats.drawioProperties,
      excalidraw: formats.excalidrawProperties,
      mermaid: formats.mermaidProperties,
    }[kind.value];
    emit("metadataChange", { properties: read(text) });
  } catch (error) {
    console.error("Failed to read the diagram's properties.", error);
  }
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
    shownPage.value = page.value;
    if (pages.value.length > 1)
      emit("metadataChange", { pageCount: pages.value.length });
    if (!described) {
      described = true;
      void describe(source.value);
    }
  } catch (error) {
    if (reading.signal.aborted || current !== generation) return;
    console.error("Failed to render the diagram.", error);
    emit("failed");
  }
}

function capabilities(): Partial<PreviewRendererCapabilities> {
  return {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
    toolbar: kind.value === "drawio",
    annotateRegions: loaded.value,
  };
}

function imageLoaded(): void {
  if (loaded.value) return;
  loaded.value = true;
  emit("capabilitiesChange", capabilities());
}

/** The drawn diagram; each page of a draw.io file is its own segment. */
function annotationTargets(): readonly AnnotationTarget[] {
  const target = stage.value?.annotationTarget();
  if (!target) return [];
  return pages.value.length > 1
    ? [pageTarget(target.element, shownPage.value, target.size)]
    : [target];
}

function revealAnnotation(request: AnnotationRevealRequest): void {
  const number = requestedPage(request);
  if (number && number <= pages.value.length) page.value = number;
}

onMounted(() => {
  emit("capabilitiesChange", capabilities());
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

defineExpose({
  fitWidth: () => stage.value?.fitWidth(),
  annotationTargets,
  revealAnnotation,
});
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
      @load="imageLoaded"
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
    <div v-else class="absolute inset-0 grid place-items-center" role="status">
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
