<script setup lang="ts">
import { useEventListener, useResizeObserver } from "@vueuse/core";
import {
  computed,
  onScopeDispose,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { cn } from "@/lib/utils";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import type {
  AnnotationCells,
  AnnotationPlace,
  AnnotationShape,
  AnnotationTarget,
} from "./file-preview/previewRenderer";

type Region = Extract<AnnotationShape, { kind: "region" }>;

/**
 * Marks commented cells and areas over a preview with amber boxes, and lets
 * the user draw a box on an image, page or slide to comment on that area.
 * Text comments are CSS highlights instead, and time comments live on the
 * media timeline.
 */
const props = defineProps<{
  /** Element the overlay covers: the preview around the renderer. */
  container: HTMLElement | null;
  annotations: readonly PreviewAnnotation[];
  activeId: string | undefined;
  /** Cells or an area being commented on, shown as active while typing. */
  draft: AnnotationShape | undefined;
  /** Drawing a box for a new area comment. */
  drawing: boolean;
  targets: () => readonly AnnotationTarget[];
  cellRects: (cells: AnnotationCells) => readonly DOMRect[];
}>();
const emit = defineEmits<{
  select: [id: string];
  drawn: [
    input: {
      shape: Region;
      place?: AnnotationPlace;
      size?: AnnotationTarget["size"];
      rect: () => DOMRect;
    },
  ];
  cancelDrawing: [];
}>();
const { t } = useI18n();

interface Box {
  key: string;
  id?: string;
  active: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlay = useTemplateRef<HTMLElement>("overlay");
const boxes = shallowRef<Box[]>([]);
/** The container's box when the boxes were measured. */
let origin = new DOMRect();
let frame = 0;

function targetFor(segment: string | undefined): AnnotationTarget | undefined {
  const targets = props.targets();
  return (
    targets.find((target) => target.segment === segment) ??
    (segment === undefined && targets.length === 1 ? targets[0] : undefined)
  );
}

/** Where an area is now, in the app window's coordinates. */
function regionRect(region: Region): DOMRect | undefined {
  const target = targetFor(region.segment);
  if (!target) return undefined;
  const box = target.element.getBoundingClientRect();
  if (!box.width || !box.height) return undefined;
  return new DOMRect(
    box.left + region.x * box.width,
    box.top + region.y * box.height,
    region.width * box.width,
    region.height * box.height,
  );
}

function shapeRects(shape: AnnotationShape): readonly DOMRect[] {
  if (shape.kind === "region") {
    const rect = regionRect(shape);
    return rect ? [rect] : [];
  }
  return shape.kind === "cells" ? props.cellRects(shape.cells) : [];
}

function measure(): void {
  frame = 0;
  const container = props.container;
  if (!container) {
    boxes.value = [];
    return;
  }
  origin = container.getBoundingClientRect();
  const next: Box[] = [];
  const add = (key: string, rect: DOMRect, active: boolean, id?: string) => {
    // Only what is within the preview; scrolled-out boxes would float over
    // the chrome around it.
    const left = Math.max(rect.left, origin.left);
    const top = Math.max(rect.top, origin.top);
    const right = Math.min(rect.right, origin.right);
    const bottom = Math.min(rect.bottom, origin.bottom);
    if (right - left < 1 || bottom - top < 1) return;
    next.push({
      key,
      id,
      active,
      left: left - origin.left,
      top: top - origin.top,
      width: right - left,
      height: bottom - top,
    });
  };
  for (const annotation of props.annotations) {
    const anchor = annotation.anchor;
    if (anchor.kind !== "cells" && anchor.kind !== "region") continue;
    shapeRects(anchor).forEach((rect, index) =>
      add(
        `${annotation.id}:${index}`,
        rect,
        annotation.id === props.activeId,
        annotation.id,
      ),
    );
  }
  if (props.draft)
    shapeRects(props.draft).forEach((rect, index) =>
      add(`draft:${index}`, rect, true),
    );
  boxes.value = next;
}

function schedule(): void {
  if (!frame) frame = requestAnimationFrame(measure);
}

watch(
  () => [props.annotations, props.activeId, props.draft, props.container],
  schedule,
  { immediate: true },
);
// Scrolling, zooming and re-rendering move what the boxes mark.
useEventListener(document, "scroll", schedule, {
  capture: true,
  passive: true,
});
useEventListener(window, "resize", schedule);
useResizeObserver(() => props.container, schedule);
let observer: MutationObserver | undefined;
watch(
  () => props.container,
  (container) => {
    observer?.disconnect();
    if (!container) return;
    // The overlay's own boxes are inside the container; their changes are not.
    observer = new MutationObserver((records) => {
      if (records.some((record) => !overlay.value?.contains(record.target)))
        schedule();
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "transform", "width", "height"],
    });
  },
  { immediate: true },
);
defineExpose({ refresh: schedule });

onScopeDispose(() => {
  observer?.disconnect();
  if (frame) cancelAnimationFrame(frame);
});

// A click on a marked area or cell opens its comment. The boxes let events
// through, so selecting text and cells under them still works.
useEventListener(
  () => props.container,
  "click",
  (event: MouseEvent) => {
    if (props.drawing || event.button !== 0) return;
    const x = event.clientX - origin.left;
    const y = event.clientY - origin.top;
    const box = [...boxes.value]
      .reverse()
      .find(
        (item) =>
          item.id &&
          x >= item.left &&
          x <= item.left + item.width &&
          y >= item.top &&
          y <= item.top + item.height,
      );
    if (box?.id) emit("select", box.id);
  },
);

/** The box being drawn, in the container's coordinates. */
const drag = ref<{
  target: AnnotationTarget;
  bounds: DOMRect;
  startX: number;
  startY: number;
  x: number;
  y: number;
}>();
const dragBox = computed(() => {
  const current = drag.value;
  if (!current) return undefined;
  return {
    left: Math.min(current.startX, current.x) - origin.left,
    top: Math.min(current.startY, current.y) - origin.top,
    width: Math.abs(current.x - current.startX),
    height: Math.abs(current.y - current.startY),
  };
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function startDrawing(event: PointerEvent): void {
  if (event.button !== 0) return;
  origin = props.container?.getBoundingClientRect() ?? origin;
  // The topmost target under the pointer.
  const target = [...props.targets()].reverse().find((candidate) => {
    const box = candidate.element.getBoundingClientRect();
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    );
  });
  if (!target) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag.value = {
    target,
    bounds: target.element.getBoundingClientRect(),
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
  };
}

function moveDrawing(event: PointerEvent): void {
  const current = drag.value;
  if (!current) return;
  current.x = clamp(event.clientX, current.bounds.left, current.bounds.right);
  current.y = clamp(event.clientY, current.bounds.top, current.bounds.bottom);
}

function finishDrawing(): void {
  const current = drag.value;
  drag.value = undefined;
  if (!current) return;
  const { bounds, target } = current;
  const left = Math.min(current.startX, current.x);
  const top = Math.min(current.startY, current.y);
  const width = Math.abs(current.x - current.startX);
  const height = Math.abs(current.y - current.startY);
  // A click without a drag is not an area.
  if (width < 4 || height < 4) return;
  const shape: Region = {
    kind: "region",
    ...(target.segment !== undefined ? { segment: target.segment } : {}),
    x: (left - bounds.left) / bounds.width,
    y: (top - bounds.top) / bounds.height,
    width: width / bounds.width,
    height: height / bounds.height,
  };
  emit("drawn", {
    shape,
    ...(target.place ? { place: target.place } : {}),
    ...(target.size ? { size: target.size } : {}),
    rect: () => regionRect(shape) ?? new DOMRect(left, top, width, height),
  });
}

useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (props.drawing && event.key === "Escape") {
    event.preventDefault();
    drag.value = undefined;
    emit("cancelDrawing");
  }
});
watch(
  () => props.drawing,
  (drawing) => {
    if (!drawing) drag.value = undefined;
    schedule();
  },
);
</script>

<template>
  <div
    ref="overlay"
    data-slot="preview-annotation-overlay"
    class="pointer-events-none absolute inset-0 z-10 overflow-hidden"
  >
    <div
      v-for="box in boxes"
      :key="box.key"
      :data-annotation-id="box.id"
      :class="
        cn(
          'absolute rounded-sm border transition-colors',
          box.active
            ? 'border-annotation bg-annotation/30'
            : 'border-annotation/70 bg-annotation/15',
        )
      "
      :style="{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }"
    />
    <div
      v-if="drawing"
      data-slot="preview-annotation-drawing"
      class="pointer-events-auto absolute inset-0 cursor-crosshair"
      role="application"
      :aria-label="t('project.preview.annotations.drawHint')"
      @pointerdown="startDrawing"
      @pointermove="moveDrawing"
      @pointerup="finishDrawing"
      @pointercancel="drag = undefined"
    >
      <div
        v-if="dragBox"
        class="absolute rounded-sm border border-annotation bg-annotation/30"
        :style="{
          left: `${dragBox.left}px`,
          top: `${dragBox.top}px`,
          width: `${dragBox.width}px`,
          height: `${dragBox.height}px`,
        }"
      />
      <div
        class="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-popover px-3 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {{ t("project.preview.annotations.drawHint") }}
      </div>
    </div>
  </div>
</template>
