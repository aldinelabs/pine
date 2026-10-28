<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";

/**
 * An image on a scrollable stage that follows the preview's zoom. It fits
 * itself when it first loads and after a rotation; the compact workbench
 * card, which has no zoom control, keeps it fitted as it resizes.
 */
const props = withDefaults(
  defineProps<{
    src?: string;
    alt: string;
    /** Zoom in percent of the image's natural size. */
    zoom: number;
    /** Clockwise rotation in quarter turns' degrees. */
    rotation?: number;
    compact?: boolean;
  }>(),
  { rotation: 0 },
);
const emit = defineEmits<{
  load: [size: { width: number; height: number }];
  error: [];
  /** The stage fitted the image; the preview's zoom should show this level. */
  zoomChange: [zoom: number];
}>();

/** Space kept around the image when it is fitted. */
const MARGIN = 24;

const viewport = useTemplateRef<HTMLDivElement>("viewport");
const natural = ref<{ width: number; height: number }>();
const scale = ref(1);
const turned = computed(() => props.rotation % 180 !== 0);
const frame = computed(() => {
  const size = natural.value;
  if (!size) return undefined;
  const width = size.width * scale.value;
  const height = size.height * scale.value;
  return turned.value
    ? { width: height, height: width, imageWidth: width, imageHeight: height }
    : { width, height, imageWidth: width, imageHeight: height };
});

function fitScale(widthOnly = false): number {
  const element = viewport.value;
  const size = natural.value;
  if (!element || !size) return 1;
  const [width, height] = turned.value
    ? [size.height, size.width]
    : [size.width, size.height];
  const byWidth = (element.clientWidth - MARGIN * 2) / width;
  const byHeight = (element.clientHeight - MARGIN * 2) / height;
  return Math.max(0.01, widthOnly ? byWidth : Math.min(byWidth, byHeight, 1));
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

function settle(next: number): void {
  void applyScale(next);
  if (!props.compact) emit("zoomChange", Math.round(next * 100));
}

function fit(): void {
  settle(fitScale());
}

function fitWidth(): void {
  settle(fitScale(true));
}

function loaded(event: Event): void {
  const image = event.target as HTMLImageElement;
  const first = !natural.value;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
  emit("load", natural.value);
  if (first) void nextTick(fit);
}

watch(
  () => props.zoom,
  (value) => {
    if (!props.compact && natural.value) void applyScale(value / 100);
  },
);
watch(
  () => props.rotation,
  () => void nextTick(fit),
);

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  if (!props.compact || !viewport.value) return;
  resizeObserver = new ResizeObserver(() => void applyScale(fitScale()));
  resizeObserver.observe(viewport.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

defineExpose({ fit, fitWidth });
</script>

<template>
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
          v-if="src"
          :src="src"
          :alt="alt"
          draggable="false"
          class="absolute top-1/2 left-1/2 max-w-none"
          :style="{
            width: frame ? `${frame.imageWidth}px` : undefined,
            height: frame ? `${frame.imageHeight}px` : undefined,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
            visibility: natural ? undefined : 'hidden',
          }"
          @load="loaded"
          @error="emit('error')"
        />
      </div>
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
