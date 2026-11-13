<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  ZoomIn,
  ZoomOut,
} from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ZoomableImage from "@/components/project/file-preview/ZoomableImage.vue";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import type { MarkdownViewerImage } from "./markdownImageContext";

/**
 * An enlarged view of a Markdown document's images. The image fits the
 * stage when it opens and zooms and pans like the image file preview.
 */
const props = defineProps<{ images: MarkdownViewerImage[] }>();
const open = defineModel<boolean>("open", { required: true });
const index = defineModel<number>("index", { required: true });
const { t } = useI18n();
const stage = useTemplateRef<InstanceType<typeof ZoomableImage>>("stage");

const ZOOM_MIN = 10;
const ZOOM_MAX = 800;
/** The levels the zoom buttons step through, as in the file preview. */
const ZOOM_STEPS = [
  10, 25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400,
  500, 600, 800,
];

const zoom = ref(100);
const current = computed(() => props.images[index.value]);
const count = computed(() => props.images.length);

watch(current, () => {
  zoom.value = 100;
});

function clampZoom(value: number): number {
  return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)));
}

function stepZoom(direction: -1 | 1): void {
  const value = zoom.value;
  zoom.value =
    direction > 0
      ? (ZOOM_STEPS.find((step) => step > value) ?? ZOOM_MAX)
      : ([...ZOOM_STEPS].reverse().find((step) => step < value) ?? ZOOM_MIN);
}

function move(step: -1 | 1): void {
  if (count.value < 2) return;
  index.value = (index.value + step + count.value) % count.value;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.altKey) return;
  const modified = event.metaKey || event.ctrlKey;
  if (!modified && event.key === "ArrowLeft") move(-1);
  else if (!modified && event.key === "ArrowRight") move(1);
  else if (modified && (event.key === "=" || event.key === "+")) stepZoom(1);
  else if (modified && (event.key === "-" || event.key === "_")) stepZoom(-1);
  else if (modified && event.key === "0") stage.value?.fit();
  else return;
  event.preventDefault();
}

/** ⌘ or Ctrl with the wheel, or a trackpad pinch, zooms the image. */
function handleWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom.value = clampZoom(zoom.value * Math.exp(-event.deltaY * 0.005));
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-slot="markdown-image-viewer"
      :class="[
        'flex h-[min(56rem,calc(100dvh-4rem))] w-[calc(100vw-4rem)] max-w-none flex-col gap-4 sm:max-w-6xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
      @keydown="handleKeydown"
    >
      <DialogHeader class="min-w-0 pr-12">
        <DialogTitle class="truncate" :title="current?.name">
          {{ current?.name }}
        </DialogTitle>
        <DialogDescription class="sr-only">
          {{ t("markdown.imageViewer.description") }}
        </DialogDescription>
      </DialogHeader>
      <div
        class="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-muted/50"
        @wheel="handleWheel"
      >
        <ZoomableImage
          v-if="current"
          ref="stage"
          :key="current.src"
          :src="current.src"
          :alt="current.name"
          :zoom="zoom"
          @zoom-change="zoom = $event"
        />
      </div>
      <div
        role="toolbar"
        :aria-label="t('markdown.imageViewer.controls')"
        class="flex min-h-8 shrink-0 items-center gap-2 text-sm text-muted-foreground"
      >
        <template v-if="count > 1">
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('markdown.imageViewer.previous')"
            data-testid="markdown-image-previous"
            @click="move(-1)"
          >
            <ChevronLeft />
          </Button>
          <span class="tabular-nums">{{
            t("markdown.imageViewer.position", {
              index: index + 1,
              count,
            })
          }}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('markdown.imageViewer.next')"
            data-testid="markdown-image-next"
            @click="move(1)"
          >
            <ChevronRight />
          </Button>
        </template>
        <div class="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" @click="stage?.fit()">
            <Maximize data-icon="inline-start" />
            {{ t("markdown.imageViewer.fit") }}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('project.preview.zoomOut')"
            :disabled="zoom <= ZOOM_MIN"
            @click="stepZoom(-1)"
          >
            <ZoomOut />
          </Button>
          <span
            class="w-12 text-center tabular-nums"
            :title="t('project.preview.zoomValue', { value: zoom })"
            >{{ zoom }}%</span
          >
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('project.preview.zoomIn')"
            :disabled="zoom >= ZOOM_MAX"
            @click="stepZoom(1)"
          >
            <ZoomIn />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
