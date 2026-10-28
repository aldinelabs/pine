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
import { useI18n } from "vue-i18n";
import { RotateCcw, RotateCw } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { decodeHeic, openTiff, type TiffDocument } from "@/lib/imageDecoding";
import { previewExtension } from "@/shared/previewFormats";
import PreviewPager from "./PreviewPager.vue";
import ZoomableImage from "./ZoomableImage.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const extension = computed(() => previewExtension(props.filePath));
const source = ref<string>();
const loaded = ref(false);
const rotation = ref(0);
const page = ref(1);
const tiff = shallowRef<TiffDocument>();
const reading = new AbortController();
const objectUrls = new Map<number, string>();
let ownedUrl: string | undefined;

function rotate(step: 1 | -1): void {
  rotation.value = (rotation.value + step * 90 + 360) % 360;
}

function imageLoaded(size: { width: number; height: number }): void {
  loaded.value = true;
  emit("metadataChange", {
    ...size,
    ...(tiff.value ? { pageCount: tiff.value.pageCount } : {}),
  });
}

function fitWidth(): void {
  stage.value?.fitWidth();
}

async function showTiffPage(number: number): Promise<void> {
  const document = tiff.value;
  if (!document) return;
  let url = objectUrls.get(number);
  if (!url) {
    url = URL.createObjectURL(await document.page(number));
    objectUrls.set(number, url);
  }
  source.value = url;
}

async function load(): Promise<void> {
  const preview = props.preview;
  const kind = extension.value;
  if (
    preview.kind === "document" &&
    kind !== "heic" &&
    kind !== "heif" &&
    kind !== "tif" &&
    kind !== "tiff"
  ) {
    source.value = preview.url;
    return;
  }
  const bytes = await readPreviewBytes(preview, reading.signal);
  if (kind === "tif" || kind === "tiff") {
    tiff.value = await openTiff(bytes);
    await showTiffPage(1);
    return;
  }
  const blob =
    kind === "heic" || kind === "heif"
      ? await decodeHeic(bytes)
      : new Blob([bytes], { type: "image/svg+xml" });
  ownedUrl = URL.createObjectURL(blob);
  source.value = ownedUrl;
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    fitWidth: !props.compact,
    zoomMin: 10,
    zoomMax: 800,
    toolbar: true,
  });
  try {
    await load();
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to render the image preview.", error);
    emit("failed");
  }
});

onBeforeUnmount(() => {
  reading.abort();
  if (ownedUrl) URL.revokeObjectURL(ownedUrl);
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
});

watch(page, (value) => {
  showTiffPage(value).catch((error: unknown) => {
    console.error("Failed to render the TIFF page.", error);
    emit("failed");
  });
});

defineExpose({ fitWidth });
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar" :to="toolbar">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.rotateLeft')"
        :disabled="!loaded"
        @click="rotate(-1)"
      >
        <RotateCcw />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.rotateRight')"
        :disabled="!loaded"
        @click="rotate(1)"
      >
        <RotateCw />
      </Button>
      <PreviewPager
        v-if="tiff && tiff.pageCount > 1"
        v-model:page="page"
        :page-count="tiff.pageCount"
      />
    </Teleport>
    <ZoomableImage
      ref="stage"
      :src="source"
      :alt="fileName"
      :zoom="zoom"
      :rotation="rotation"
      :compact="compact"
      @load="imageLoaded"
      @error="emit('failed')"
      @zoom-change="emit('zoomChange', $event)"
    />
    <div
      v-if="!loaded"
      class="absolute inset-0 grid place-items-center bg-background"
      role="status"
    >
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>
