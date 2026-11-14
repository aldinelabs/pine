<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { Spinner } from "@/components/ui/spinner";
import { readWebArchive } from "@/lib/bplist";
import { decodeHtml, inlineResources } from "@/lib/htmlSandbox";
import { previewExtension } from "@/shared/previewFormats";
import HtmlFrame from "./HtmlFrame.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  AnnotationSurface,
  PreviewRendererEvents,
  PreviewRendererHandle,
  PreviewRendererProps,
} from "./previewRenderer";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const html = ref<string>();
const reading = new AbortController();
const frame = useTemplateRef<InstanceType<typeof HtmlFrame>>("frame");

/** Comments anchor in the page's body, once the frame has loaded it. */
function annotationSurface(): AnnotationSurface | undefined {
  const body = frame.value?.body();
  return body ? { root: body } : undefined;
}

function handleLoad(): void {
  if (!props.compact) emit("capabilitiesChange", { annotate: true });
}

defineExpose<PreviewRendererHandle>({ annotationSurface });

async function load(): Promise<string> {
  const preview = props.preview;
  if (previewExtension(props.filePath) === "webarchive") {
    const archive = readWebArchive(
      await readPreviewBytes(preview, reading.signal),
    );
    return inlineResources(
      decodeHtml(archive.main.data, archive.main.encoding),
      archive.subresources,
    );
  }
  if (preview.kind === "text") return preview.text;
  return decodeHtml(
    new Uint8Array(await readPreviewBytes(preview, reading.signal)),
  );
}

onMounted(async () => {
  try {
    html.value = await load();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the page preview.", error);
    emit("failed");
  }
});
onBeforeUnmount(() => reading.abort());
</script>

<template>
  <HtmlFrame
    v-if="html !== undefined"
    ref="frame"
    :html="html"
    :title="fileName"
    :zoom="compact ? 100 : zoom"
    @load="handleLoad"
  />
  <div v-else class="grid h-full place-items-center" role="status">
    <Spinner class="size-5 text-muted-foreground" />
  </div>
</template>
