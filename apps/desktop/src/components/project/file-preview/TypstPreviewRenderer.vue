<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { FileWarning } from "@lucide/vue";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { compileTypst, splitTypstPages, typstErrorMessages } from "@/lib/typst";
import PreviewPager from "./PreviewPager.vue";
import { readPreviewText } from "./previewBytes";
import type {
  PreviewRendererEvents,
  PreviewRendererProps,
} from "./previewRenderer";
import { usePreviewToolbar } from "./usePreviewToolbar";

/**
 * Typst documents as pages. Each page is an SVG shown as an image, which
 * runs no scripts and loads nothing; 100% fits the preview's width.
 */
const props = defineProps<PreviewRendererProps>();
const emit = defineEmits<PreviewRendererEvents>();
const { t } = useI18n();
const toolbar = usePreviewToolbar(() => props.compact);
const stage = useTemplateRef<HTMLDivElement>("stage");

const MARGIN = 24;

const pages = ref<{ url: string; width: number; height: number }[]>([]);
const page = ref(1);
const width = ref(0);
const loading = ref(true);
const error = ref<string>();
const reading = new AbortController();
let resizeObserver: ResizeObserver | undefined;
let scrolling = false;

function measure(): void {
  width.value = Math.max(200, (stage.value?.clientWidth ?? 800) - MARGIN * 2);
}

function pageWidth(): number {
  return Math.round((width.value * (props.compact ? 100 : props.zoom)) / 100);
}

function trackPage(): void {
  const element = stage.value;
  if (!element || scrolling) return;
  const frames = Array.from(
    element.querySelectorAll<HTMLElement>("[data-typst-page]"),
  );
  const middle = element.scrollTop + element.clientHeight / 3;
  const index = frames.findIndex(
    (frame) => frame.offsetTop + frame.offsetHeight > middle,
  );
  if (index >= 0) page.value = index + 1;
}

function goTo(target: number): void {
  const frame = stage.value?.querySelectorAll("[data-typst-page]")[target - 1];
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
    renderToggle: props.preview.kind === "text",
    toolbar: !props.compact,
  });
  measure();
  if (stage.value) {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(stage.value);
  }
  let source: string;
  try {
    source = await readPreviewText(props.preview, reading.signal);
  } catch (reason) {
    if (reading.signal.aborted) return;
    console.error("Failed to read the Typst document.", reason);
    emit("failed");
    return;
  }
  try {
    const compiled = splitTypstPages(await compileTypst(source));
    if (reading.signal.aborted) return;
    pages.value = compiled.map((item) => ({
      width: item.width,
      height: item.height,
      url: URL.createObjectURL(new Blob([item.svg], { type: "image/svg+xml" })),
    }));
    emit("metadataChange", { pageCount: compiled.length });
  } catch (reason) {
    if (reading.signal.aborted) return;
    // A document with errors is still the user's to fix, so the compiler's
    // message is shown instead of a generic failure.
    error.value = typstErrorMessages(reason).join("\n");
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  reading.abort();
  resizeObserver?.disconnect();
  for (const item of pages.value) URL.revokeObjectURL(item.url);
});
</script>

<template>
  <div class="relative h-full min-h-0">
    <Teleport v-if="toolbar && pages.length > 1" :to="toolbar">
      <PreviewPager
        :page="page"
        :page-count="pages.length"
        @update:page="goTo"
      />
    </Teleport>
    <Empty v-if="error" class="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileWarning /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.typstFailed") }}</EmptyTitle>
        <EmptyDescription>
          <pre
            class="max-h-60 overflow-auto text-left font-mono text-xs whitespace-pre-wrap"
            >{{ error }}</pre>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div
      v-else
      ref="stage"
      data-slot="typst-preview"
      class="scroll-fade absolute inset-0 overflow-auto"
      @scroll.passive="trackPage"
    >
      <div
        class="flex w-max min-w-full flex-col items-center gap-4"
        :style="{ padding: `${MARGIN}px` }"
      >
        <img
          v-for="(item, index) in pages"
          :key="item.url"
          data-typst-page
          :src="item.url"
          :alt="t('project.preview.pageLabel', { page: index + 1 })"
          :class="['typst-page', inverted && 'typst-page-inverted']"
          :style="{
            width: `${pageWidth()}px`,
            aspectRatio: `${item.width} / ${item.height}`,
          }"
          draggable="false"
        />
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
/* Pages are paper: white, with a hairline edge instead of a shadow. */
.typst-page {
  max-width: none;
  background: #fff;
  box-shadow: 0 0 0 1px var(--border);
}

.typst-page-inverted {
  filter: invert(1) hue-rotate(180deg);
}
</style>
