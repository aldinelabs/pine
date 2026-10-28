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
import { readPreviewBytes } from "./previewBytes";
import type {
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

onMounted(async () => {
  try {
    const value = readPostScript(
      await readPreviewBytes(props.preview, reading.signal),
    );
    image.value = await bitmapUrl(value);
    content.value = value;
    if (image.value)
      emit("capabilitiesChange", {
        zoom: !props.compact,
        fitWidth: !props.compact,
        zoomMin: 10,
        zoomMax: 800,
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

defineExpose({
  fitWidth: () =>
    image.value ? stage.value?.fitWidth() : pdf.value?.fitWidth?.(),
  readSelection: () => pdf.value?.readSelection?.(),
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
