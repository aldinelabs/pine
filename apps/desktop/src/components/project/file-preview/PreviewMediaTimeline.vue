<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { Slider } from "@/components/ui/slider";
import { formatTimeSpan } from "@/lib/annotationLocation";
import { cn } from "@/lib/utils";
import {
  normalizeSpan,
  spanPercent,
  spanRect,
  timeAtPosition,
  type TimeSpan,
} from "./mediaControls";

export interface TimelineComment extends TimeSpan {
  id: string;
  comment: string;
}

const props = defineProps<{
  currentTime: number;
  duration: number;
  comments: readonly TimelineComment[];
  activeId?: string;
  /** The span being commented on now. */
  draft?: TimeSpan;
  /** In and out points set with I and O. */
  markIn?: number;
  markOut?: number;
  /** Shift-drag marks a span to comment on. */
  annotatable: boolean;
}>();

const emit = defineEmits<{
  /** `commit` once the thumb is let go. */
  seek: [time: number, commit: boolean];
  select: [id: string];
  mark: [span: TimeSpan];
}>();

const { t } = useI18n();
const timeline = useTemplateRef<HTMLElement>("timeline");
/** Holds the thumb while it is dragged, so playback does not pull it back. */
const dragged = ref<number>();
/** The span being shift-dragged. */
const marking = ref<{ from: number; to: number; x: number; moved: boolean }>();

const position = computed(() => [dragged.value ?? props.currentTime]);

function style(span: TimeSpan): Record<string, string> {
  const { left, width } = spanPercent(span, props.duration);
  return { left: `${left}%`, width: `${width}%` };
}

const markingSpan = computed(() =>
  marking.value
    ? normalizeSpan(marking.value.from, marking.value.to)
    : undefined,
);
const shownDraft = computed(() => markingSpan.value ?? props.draft);
const pendingMark = computed(() => {
  if (props.markIn === undefined && props.markOut === undefined)
    return undefined;
  return normalizeSpan(
    props.markIn ?? props.markOut ?? 0,
    props.markOut ?? props.markIn ?? 0,
  );
});

function update(value: number[] | undefined): void {
  dragged.value = value?.[0] ?? 0;
  emit("seek", dragged.value, false);
}

function commit(value: number[]): void {
  dragged.value = undefined;
  emit("seek", value[0] ?? 0, true);
}

function timeAt(clientX: number): number {
  const rect = timeline.value?.getBoundingClientRect();
  return rect ? timeAtPosition(clientX, rect, props.duration) : 0;
}

function startMarking(event: PointerEvent): void {
  if (!event.shiftKey || !props.annotatable || !props.duration) return;
  if (event.button !== 0) return;
  // Keep the slider from seeking: the drag marks a span instead.
  event.stopPropagation();
  event.preventDefault();
  const time = timeAt(event.clientX);
  marking.value = { from: time, to: time, x: event.clientX, moved: false };
  (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
}

function moveMarking(event: PointerEvent): void {
  if (!marking.value) return;
  marking.value.to = timeAt(event.clientX);
  if (Math.abs(event.clientX - marking.value.x) > 3) marking.value.moved = true;
}

function endMarking(event: PointerEvent): void {
  const current = marking.value;
  if (!current) return;
  marking.value = undefined;
  (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  const to = current.moved ? timeAt(event.clientX) : current.from;
  emit("mark", normalizeSpan(current.from, to));
}

function cancelMarking(): void {
  marking.value = undefined;
}

/** A span's box on the timeline, in the app window's coordinates. */
function rectFor(span: TimeSpan): DOMRect {
  const rect = timeline.value?.getBoundingClientRect() ?? new DOMRect();
  return spanRect(rect, span, props.duration);
}

defineExpose({ rectFor });
</script>

<template>
  <div
    ref="timeline"
    class="relative w-full pt-3"
    data-slot="media-timeline"
    @pointerdown.capture="startMarking"
    @pointermove="moveMarking"
    @pointerup="endMarking"
    @pointercancel="cancelMarking"
  >
    <div class="pointer-events-none absolute inset-x-0 top-0 h-2">
      <button
        v-for="item in comments"
        :key="item.id"
        type="button"
        data-slot="media-comment-span"
        :data-active="item.id === activeId ? '' : undefined"
        :aria-label="
          t('project.preview.media.commentAt', {
            time: formatTimeSpan(item.start, item.end),
            comment: item.comment,
          })
        "
        :title="item.comment"
        :class="
          cn(
            'pointer-events-auto absolute top-0 h-2 min-w-1.5 rounded-full border border-annotation/70 bg-annotation/40 transition-colors outline-none hover:bg-annotation/70 focus-visible:ring-2 focus-visible:ring-ring/50',
            item.id === activeId && 'z-10 border-annotation bg-annotation',
          )
        "
        :style="style(item)"
        @pointerdown.stop
        @click="emit('select', item.id)"
      />
      <div
        v-if="pendingMark && !shownDraft"
        data-slot="media-mark"
        class="absolute top-0 h-2 min-w-0.5 rounded-full border border-dashed border-annotation"
        :style="style(pendingMark)"
      />
      <div
        v-if="shownDraft"
        data-slot="media-draft-span"
        class="absolute top-0 z-20 h-2 min-w-1.5 rounded-full border border-annotation bg-annotation"
        :style="style(shownDraft)"
      />
    </div>
    <Slider
      class="py-1.5"
      :model-value="position"
      :min="0"
      :max="duration || 1"
      :step="0.1"
      :disabled="!duration"
      :aria-label="t('project.preview.seek')"
      @update:model-value="update"
      @value-commit="commit"
    />
  </div>
</template>
