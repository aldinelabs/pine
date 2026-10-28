<script setup lang="ts">
import {
  computed,
  nextTick,
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
const viewport = useTemplateRef<HTMLDivElement>("viewport");

/** Space kept around the image when it is fitted. */
const MARGIN = 24;

const extension = computed(() => previewExtension(props.filePath));
const source = ref<string>();
const natural = ref<{ width: number; height: number }>();
const rotation = ref(0);
const page = ref(1);
const tiff = shallowRef<TiffDocument>();
const loading = ref(true);
const reading = new AbortController();
const objectUrls = new Map<number, string>();
let ownedUrl: string | undefined;

const turned = computed(() => rotation.value % 180 !== 0);
/** The compact card always fits; elsewhere the preview's zoom applies. */
const scale = ref(1);
const frame = computed(() => {
  const size = natural.value;
  if (!size) return undefined;
  const width = size.width * scale.value;
  const height = size.height * scale.value;
  return turned.value
    ? { width: height, height: width, imageWidth: width, imageHeight: height }
    : { width, height, imageWidth: width, imageHeight: height };
});

function rotatedSize(): { width: number; height: number } | undefined {
  const size = natural.value;
  if (!size) return undefined;
  return turned.value
    ? { width: size.height, height: size.width }
    : { ...size };
}

function fitScale(widthOnly = false): number {
  const element = viewport.value;
  const size = rotatedSize();
  if (!element || !size) return 1;
  const width = (element.clientWidth - MARGIN * 2) / size.width;
  const height = (element.clientHeight - MARGIN * 2) / size.height;
  const fitted = widthOnly ? width : Math.min(width, height, 1);
  return Math.max(0.01, fitted);
}

/** Keeps the point at the viewport's center in place while the scale changes. */
async function applyScale(next: number): Promise<void> {
  const element = viewport.value;
  if (!element || next === scale.value) {
    scale.value = next;
    return;
  }
  const ratio = next / scale.value;
  const centerX = element.scrollLeft + element.clientWidth / 2;
  const centerY = element.scrollTop + element.clientHeight / 2;
  scale.value = next;
  await nextTick();
  element.scrollLeft = centerX * ratio - element.clientWidth / 2;
  element.scrollTop = centerY * ratio - element.clientHeight / 2;
}

function reportScale(next: number): void {
  void applyScale(next);
  if (!props.compact) emit("zoomChange", Math.round(next * 100));
}

function fit(): void {
  reportScale(fitScale());
}

function fitWidth(): void {
  reportScale(fitScale(true));
}

function rotate(step: 1 | -1): void {
  rotation.value = (rotation.value + step * 90 + 360) % 360;
  void nextTick(fit);
}

function loaded(event: Event): void {
  const image = event.target as HTMLImageElement;
  const first = !natural.value;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
  loading.value = false;
  emit("metadataChange", {
    width: image.naturalWidth,
    height: image.naturalHeight,
    ...(tiff.value ? { pageCount: tiff.value.pageCount } : {}),
  });
  if (first) void nextTick(fit);
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

watch(
  () => props.zoom,
  (value) => {
    if (!props.compact && natural.value) void applyScale(value / 100);
  },
);

watch(page, (value) => {
  showTiffPage(value).catch((error: unknown) => {
    console.error("Failed to render the TIFF page.", error);
    emit("failed");
  });
});

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  // The compact card has no zoom control, so it keeps the image fitted.
  if (!props.compact || !viewport.value) return;
  resizeObserver = new ResizeObserver(() => void applyScale(fitScale()));
  resizeObserver.observe(viewport.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

defineExpose({ fitWidth });
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar" :to="toolbar">
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.rotateLeft')"
        :disabled="!natural"
        @click="rotate(-1)"
      >
        <RotateCcw />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.preview.rotateRight')"
        :disabled="!natural"
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
    <div
      ref="viewport"
      data-slot="image-preview"
      class="scroll-fade absolute inset-0 overflow-auto"
    >
      <div
        class="grid min-h-full min-w-full place-items-center"
        :style="{ padding: `${MARGIN}px` }"
      >
        <div
          class="image-preview-frame relative"
          :style="
            frame
              ? { width: `${frame.width}px`, height: `${frame.height}px` }
              : undefined
          "
        >
          <img
            v-if="source"
            :src="source"
            :alt="fileName"
            draggable="false"
            class="absolute top-1/2 left-1/2 max-w-none"
            :style="{
              width: frame ? `${frame.imageWidth}px` : undefined,
              height: frame ? `${frame.imageHeight}px` : undefined,
              transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
              visibility: natural ? undefined : 'hidden',
            }"
            @load="loaded"
            @error="emit('failed')"
          />
        </div>
      </div>
    </div>
    <div
      v-if="loading"
      class="absolute inset-0 grid place-items-center bg-background"
      role="status"
    >
      <Spinner class="size-5 text-muted-foreground" />
    </div>
  </div>
</template>

<style scoped>
/* Transparent pixels sit on a quiet checkerboard instead of the page color. */
.image-preview-frame {
  --checker: color-mix(in oklch, var(--muted) 70%, transparent);
  background: repeating-conic-gradient(var(--checker) 0 25%, transparent 0 50%)
    0 0 / 16px 16px;
}
</style>
