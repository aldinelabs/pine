<script setup lang="ts">
import {
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { Spinner } from "@/components/ui/spinner";
import PreviewPager from "./PreviewPager.vue";
import { readPreviewBytes } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

/**
 * OFD (China's fixed-layout format) with the ofd.js engine. Pages render
 * for the width they are shown at, so zooming re-renders them sharp
 * instead of scaling pixels; 100% fits the preview's width.
 */
const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<HTMLDivElement>("stage");
const pagesHost = useTemplateRef<HTMLDivElement>("pages");

const MARGIN = 24;

const document_ = shallowRef<unknown>();
const pageCount = ref(0);
const page = ref(1);
const loading = ref(true);
const reading = new AbortController();
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let renderedWidth = 0;
let resizeObserver: ResizeObserver | undefined;
let scrolling = false;

function targetWidth(): number {
  const width = (stage.value?.clientWidth ?? 800) - MARGIN * 2;
  return Math.max(
    200,
    Math.round((width * (props.compact ? 100 : props.zoom)) / 100),
  );
}

async function render(): Promise<void> {
  const host = pagesHost.value;
  if (!host || !document_.value) return;
  const width = targetWidth();
  if (width === renderedWidth) return;
  const { renderOfd } = await import("@file-viewer-internal/ofd");
  const pages = renderOfd(width, document_.value);
  renderedWidth = width;
  host.replaceChildren(
    ...pages.map((element) => {
      const frame = document.createElement("div");
      frame.className = "ofd-page-frame";
      frame.append(element);
      return frame;
    }),
  );
  pageCount.value = pages.length;
  emit("metadataChange", { pageCount: pages.length });
}

function scheduleRender(delay = 150): void {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    render().catch((error: unknown) => {
      console.error("Failed to render the OFD pages.", error);
      emit("failed");
    });
  }, delay);
}

function trackPage(): void {
  const element = stage.value;
  if (!element || scrolling) return;
  const frames = Array.from(element.querySelectorAll(".ofd-page-frame"));
  const middle = element.scrollTop + element.clientHeight / 3;
  const index = frames.findIndex(
    (frame) =>
      (frame as HTMLElement).offsetTop + (frame as HTMLElement).offsetHeight >
      middle,
  );
  if (index >= 0) page.value = index + 1;
}

function goTo(target: number): void {
  const frame = stage.value?.querySelectorAll(".ofd-page-frame")[target - 1];
  if (!(frame instanceof HTMLElement)) return;
  scrolling = true;
  page.value = target;
  frame.scrollIntoView({ block: "start" });
  requestAnimationFrame(() => (scrolling = false));
}

onMounted(async () => {
  emit("capabilitiesChange", {
    zoom: !props.compact,
    invert: true,
    zoomMin: 25,
    zoomMax: 400,
    toolbar: !props.compact,
  });
  try {
    const [ofd, bytes] = await Promise.all([
      import("@file-viewer-internal/ofd"),
      readPreviewBytes(props.preview, reading.signal),
    ]);
    const documents = await new Promise<unknown[]>((resolve, reject) =>
      ofd.parseOfdDocument({ ofd: bytes, success: resolve, fail: reject }),
    );
    if (reading.signal.aborted) return;
    if (!documents[0]) throw new Error("The OFD file has no document.");
    document_.value = documents[0];
    loading.value = false;
    await render();
    if (stage.value) {
      resizeObserver = new ResizeObserver(() => scheduleRender());
      resizeObserver.observe(stage.value);
    }
  } catch (error) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the OFD file.", error);
    emit("failed");
  } finally {
    loading.value = false;
  }
});

watch(
  () => props.zoom,
  () => scheduleRender(),
);
onBeforeUnmount(() => {
  reading.abort();
  if (renderTimer) clearTimeout(renderTimer);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && pageCount > 1" :to="toolbar">
      <PreviewPager :page="page" :page-count="pageCount" @update:page="goTo" />
    </Teleport>
    <div
      ref="stage"
      data-slot="ofd-preview"
      :class="['absolute inset-0 overflow-auto', inverted && 'ofd-inverted']"
      @scroll.passive="trackPage"
    >
      <div
        ref="pages"
        class="flex w-max min-w-full flex-col items-center gap-4"
        :style="{ padding: `${MARGIN}px` }"
      />
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
/* Pages are paper: white, with a hairline edge instead of a shadow. */
:deep(.ofd-page-frame) {
  position: relative;
  background: #fff;
  box-shadow: 0 0 0 1px var(--border);
}

.ofd-inverted :deep(.ofd-page-frame) {
  filter: invert(1) hue-rotate(180deg);
}
</style>
