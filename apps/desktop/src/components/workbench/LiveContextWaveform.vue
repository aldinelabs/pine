<script setup lang="ts">
import { useMediaQuery, useResizeObserver } from "@vueuse/core";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { waveformBars } from "@/lib/liveContextWaveform";
import type { LiveContextSource } from "@/shared/liveContext";
import type { LiveContextLevelSample } from "@/stores/liveContext";

/**
 * The last few seconds of input level, scrolling right to left: a classic
 * waveform mirrored around the middle line, one colour per source (the
 * microphone in the text colour, system audio in grey). Where both sound at
 * once the louder bar is drawn first and the quieter one over it, so both
 * stay visible. Silence is a flat hairline.
 */
const props = defineProps<{
  /** Oldest first; read every frame, so it need not be reactive. */
  history: () => readonly LiveContextLevelSample[];
  sources: readonly LiveContextSource[];
  /** Paused: a still, dimmed line. */
  paused?: boolean;
}>();
const { t } = useI18n();

/** How much time the width shows. */
const WINDOW_MS = 4000;
/** One bar per this many CSS pixels: 2px bar, 1px gap. */
const BAR_PITCH = 3;
const BAR_WIDTH = 2;
/** Reduced motion: a few redraws a second instead of a smooth scroll. */
const REDUCED_FRAME_MS = 250;

const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
const canvas = ref<HTMLCanvasElement | null>(null);
const size = ref({ width: 0, height: 0 });
useResizeObserver(canvas, ([entry]) => {
  size.value = {
    width: entry.contentRect.width,
    height: entry.contentRect.height,
  };
});

const split = computed(
  () => props.sources.includes("mic") && props.sources.includes("system"),
);
const label = computed(() =>
  t(
    split.value
      ? "project.workbench.liveContext.levelBoth"
      : "project.workbench.liveContext.level",
  ),
);

function draw(now: number): void {
  const element = canvas.value;
  const context = element?.getContext("2d");
  const { width, height } = size.value;
  if (!element || !context || width === 0 || height === 0) return;
  const ratio = window.devicePixelRatio || 1;
  if (element.width !== Math.round(width * ratio)) {
    element.width = Math.round(width * ratio);
    element.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const style = getComputedStyle(element);
  const tones: Record<LiveContextSource, string> = {
    mic: style.getPropertyValue("--wave-mic").trim() || "currentColor",
    system: style.getPropertyValue("--wave-system").trim() || "currentColor",
  };
  const middle = Math.round(height / 2);
  // The resting line: always there, so silence reads as calm, not broken.
  context.globalAlpha = 0.2;
  context.fillStyle = tones.mic;
  context.fillRect(0, middle - 0.5, width, 1);
  if (props.paused) return;

  // One more bar than fits, so the oldest slides out past the left edge.
  const count = Math.max(1, Math.ceil(width / BAR_PITCH)) + 1;
  const slice = (WINDOW_MS * BAR_PITCH) / width;
  const { newest, bars: levels } = waveformBars(
    props.history(),
    now,
    count,
    slice,
  );
  // The newest bar grows at the right edge; the grid slides left with time,
  // or steps once a slice under reduced motion.
  const progress = reducedMotion.value ? 0 : (now - newest) / slice;
  const offset = width - BAR_WIDTH - (count - 1 + progress) * BAR_PITCH;
  const half = height / 2 - 1;
  const alpha: Record<LiveContextSource, number> = { mic: 0.8, system: 0.55 };
  const bar = (source: LiveContextSource, x: number, value: number): void => {
    const extent = Math.max(1, value * half);
    context.globalAlpha = alpha[source];
    context.fillStyle = tones[source];
    context.fillRect(x, middle - extent, BAR_WIDTH, extent * 2);
  };
  const [first, second] = props.sources;
  for (let index = 0; index < count; index += 1) {
    const x = offset + index * BAR_PITCH;
    const a = first ? levels[first][index] : 0;
    const b = second ? levels[second][index] : 0;
    // Louder behind, quieter in front.
    const [back, front] =
      a >= b
        ? [
            first && { source: first, value: a },
            second && { source: second, value: b },
          ]
        : [
            second && { source: second, value: b },
            first && { source: first, value: a },
          ];
    if (back && back.value > 0) bar(back.source, x, back.value);
    if (front && front.value > 0) bar(front.source, x, front.value);
  }
  context.globalAlpha = 1;
}

let frame = 0;
let lastDrawn = 0;
function loop(now: number): void {
  frame = requestAnimationFrame(loop);
  if (reducedMotion.value && now - lastDrawn < REDUCED_FRAME_MS) return;
  lastDrawn = now;
  draw(now);
}

function run(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  if (props.paused) draw(performance.now());
  else frame = requestAnimationFrame(loop);
}

onMounted(run);
watch(() => [props.paused, size.value, props.sources.join()], run);
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <canvas
    ref="canvas"
    role="img"
    :aria-label="label"
    :title="label"
    :data-paused="paused || undefined"
    class="[--wave-mic:var(--foreground)] [--wave-system:var(--muted-foreground)]"
    data-testid="live-context-waveform"
  />
</template>
