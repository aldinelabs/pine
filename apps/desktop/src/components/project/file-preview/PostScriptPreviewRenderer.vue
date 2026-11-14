<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
} from "vue";
import { Spinner } from "@/components/ui/spinner";
import { openTiff } from "@/lib/imageDecoding";
import { readPostScript, type PostScriptContent } from "@/lib/postscript";
import { postScriptProperties } from "@/lib/previewProperties/document";
import { readPreviewBytes } from "./previewBytes";
import type {
  AnnotationRevealRequest,
  AnnotationSurface,
  AnnotationTarget,
  PreviewRendererEvents,
  PreviewRendererHandle,
  PreviewRendererProps,
} from "./previewRenderer";
import TextPreviewRenderer from "./TextPreviewRenderer.vue";
import ZoomableImage from "./ZoomableImage.vue";

const FileViewerPreviewRenderer = defineAsyncComponent(
  () => import("./FileViewerPreviewRenderer.vue"),
);

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");
const pdf = useTemplateRef<PreviewRendererHandle>("pdf");

const content = shallowRef<PostScriptContent>();
const image = ref<string>();
const reading = new AbortController();

/** A PDF-compatible Illustrator file renders as the PDF it contains. */
const pdfName = computed(() => props.fileName.replace(/\.\w+$/, "") + ".pdf");
const sourcePreview = computed(() =>
  content.value && content.value.kind !== "pdf"
    ? {
        kind: "text" as const,
        text: content.value.source,
        encoding: "Latin-1",
        size: props.preview.size,
        modifiedAt: props.preview.modifiedAt,
      }
    : undefined,
);

async function bitmapUrl(
  value: PostScriptContent,
): Promise<string | undefined> {
  if (value.kind === "tiff") {
    const tiff = await openTiff(value.tiff);
    return URL.createObjectURL(await tiff.page(1));
  }
  if (value.kind === "bitmap") {
    const canvas = new OffscreenCanvas(value.width, value.height);
    canvas
      .getContext("2d")
      ?.putImageData(
        new ImageData(value.rgba, value.width, value.height),
        0,
        0,
      );
    return URL.createObjectURL(
      await canvas.convertToBlob({ type: "image/png" }),
    );
  }
  return undefined;
}

/** The DSC comments the file starts with; a PDF-compatible file has its PDF's. */
function describe(source: string): void {
  try {
    emit("metadataChange", { properties: postScriptProperties(source) });
  } catch (error) {
    console.error("Failed to read the PostScript file's properties.", error);
  }
}

onMounted(async () => {
  try {
    const value = readPostScript(
      await readPreviewBytes(props.preview, reading.signal),
    );
    image.value = await bitmapUrl(value);
    content.value = value;
    if (value.kind !== "pdf") describe(value.source);
    if (image.value)
      emit("capabilitiesChange", {
        zoom: !props.compact,
        fitWidth: !props.compact,
        zoomMin: 10,
        zoomMax: 800,
        annotateRegions: true,
      });
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the PostScript file.", error);
    emit("failed");
  }
});

onBeforeUnmount(() => {
  reading.abort();
  if (image.value) URL.revokeObjectURL(image.value);
});

/** The rendered preview image; a PDF-compatible file defers to its PDF. */
function annotationTargets(): readonly AnnotationTarget[] {
  if (!image.value) return pdf.value?.annotationTargets?.() ?? [];
  const target = stage.value?.annotationTarget();
  return target ? [target] : [];
}

function annotationSurfaces(): readonly AnnotationSurface[] {
  const handle = pdf.value;
  if (handle?.annotationSurfaces) return handle.annotationSurfaces();
  const surface = handle?.annotationSurface?.();
  return surface ? [surface] : [];
}

defineExpose({
  fitWidth: () =>
    image.value ? stage.value?.fitWidth() : pdf.value?.fitWidth?.(),
  readSelection: () => pdf.value?.readSelection?.(),
  annotationTargets,
  annotationSurfaces,
  annotationLines: (range: Range) => pdf.value?.annotationLines?.(range),
  revealAnnotation: (request: AnnotationRevealRequest) =>
    pdf.value?.revealAnnotation?.(request),
});
</script>

<template>
  <FileViewerPreviewRenderer
    v-if="content?.kind === 'pdf'"
    ref="pdf"
    v-bind="props"
    :file-name="pdfName"
    :file-path="pdfName"
    @failed="emit('failed')"
    @metadata-change="emit('metadataChange', $event)"
    @selection-change="emit('selectionChange', $event)"
    @capabilities-change="emit('capabilitiesChange', $event)"
    @annotations-change="emit('annotationsChange')"
    @zoom-change="emit('zoomChange', $event)"
  />
  <div v-else-if="image" class="relative h-full min-h-0">
    <ZoomableImage
      ref="stage"
      :src="image"
      :alt="fileName"
      :zoom="zoom"
      :compact="compact"
      @load="emit('metadataChange', $event)"
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
  </div>
  <TextPreviewRenderer
    v-else-if="sourcePreview"
    v-bind="props"
    :preview="sourcePreview"
    mode="code"
    @failed="emit('failed')"
    @selection-change="emit('selectionChange', $event)"
  />
  <div v-else class="grid h-full place-items-center" role="status">
    <Spinner class="size-5 text-muted-foreground" />
  </div>
</template>
