<script lang="ts" setup>
import { cn } from "@/lib/utils";
import { computed, onBeforeUnmount, onMounted, ref, toRefs } from "vue";

interface FlickeringGridProps {
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  width?: number;
  height?: number;
  class?: string;
  maxOpacity?: number;
}

const props = withDefaults(defineProps<FlickeringGridProps>(), {
  squareSize: 4,
  gridGap: 6,
  flickerChance: 0.3,
  color: "rgb(0, 0, 0)",
  maxOpacity: 0.3,
});

const { squareSize, gridGap, flickerChance, color, maxOpacity, width, height } =
  toRefs(props);

const containerRef = ref<HTMLDivElement>();
const canvasRef = ref<HTMLCanvasElement>();
const context = ref<CanvasRenderingContext2D>();

const isInView = ref(false);

/** The grid only redraws the cells that actually flickered, and only at this
 * rate: repainting every square every frame is what kept a background
 * decoration pegged to a full CPU core. */
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_FRAME_DELTA_SECONDS = 0.05;

const computedColor = computed(() => {
  if (!context.value) return "transparent";

  const cssVariable = color.value.match(/^var\((--[^)]+)\)$/)?.[1];
  if (!cssVariable || !containerRef.value) return color.value;

  return (
    getComputedStyle(containerRef.value).getPropertyValue(cssVariable).trim() ||
    color.value
  );
});

function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): {
  cols: number;
  rows: number;
  squares: Float32Array;
  dpr: number;
} {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const cols = Math.floor(width / (squareSize.value + gridGap.value));
  const rows = Math.floor(height / (squareSize.value + gridGap.value));

  const squares = new Float32Array(cols * rows);
  for (let i = 0; i < squares.length; i++) {
    squares[i] = Math.random() * maxOpacity.value;
  }
  return { cols, rows, squares, dpr };
}

/** Device-pixel geometry of one grid cell, indexed column by column. */
function cellOrigin(rows: number, dpr: number, index: number) {
  const pitch = (squareSize.value + gridGap.value) * dpr;
  return {
    pitch,
    size: squareSize.value * dpr,
    x: Math.floor(index / rows) * pitch,
    y: (index % rows) * pitch,
  };
}

function fillCell(
  ctx: CanvasRenderingContext2D,
  rows: number,
  squares: Float32Array,
  dpr: number,
  index: number,
) {
  const { size, x, y } = cellOrigin(rows, dpr, index);
  ctx.globalAlpha = squares[index] ?? 0;
  ctx.fillRect(x, y, size, size);
}

/** Clears and redraws a single cell, for a square that just flickered. */
function repaintCell(
  ctx: CanvasRenderingContext2D,
  rows: number,
  squares: Float32Array,
  dpr: number,
  index: number,
) {
  const { pitch, x, y } = cellOrigin(rows, dpr, index);
  ctx.clearRect(x, y, pitch, pitch);
  fillCell(ctx, rows, squares, dpr, index);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  cols: number,
  rows: number,
  squares: Float32Array,
  dpr: number,
) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = computedColor.value;
  for (let index = 0; index < cols * rows; index++) {
    fillCell(ctx, rows, squares, dpr, index);
  }
  ctx.globalAlpha = 1;
}

/** Repaints just the squares that flickered this frame. */
function updateSquares(
  ctx: CanvasRenderingContext2D,
  rows: number,
  squares: Float32Array,
  dpr: number,
  deltaTime: number,
) {
  const chance = flickerChance.value * deltaTime;
  if (chance <= 0) return;

  for (let index = 0; index < squares.length; index++) {
    if (Math.random() < chance) {
      squares[index] = Math.random() * maxOpacity.value;
      repaintCell(ctx, rows, squares, dpr, index);
    }
  }
  ctx.globalAlpha = 1;
}

const gridParams = ref<ReturnType<typeof setupCanvas>>();

function updateCanvasSize() {
  const newWidth = width.value || containerRef.value!.clientWidth;
  const newHeight = height.value || containerRef.value!.clientHeight;

  gridParams.value = setupCanvas(canvasRef.value!, newWidth, newHeight);
  drawGrid(
    context.value!,
    canvasRef.value!,
    gridParams.value.cols,
    gridParams.value.rows,
    gridParams.value.squares,
    gridParams.value.dpr,
  );
}

let animationFrameId: number | undefined;
let resizeObserver: ResizeObserver | undefined;
let intersectionObserver: IntersectionObserver | undefined;
/** -1 until the first frame arrives, so that frame never flickers the grid. */
let lastTime = -1;

function animate(time: number) {
  if (!isInView.value) return;

  if (lastTime >= 0 && time - lastTime < FRAME_INTERVAL_MS) {
    animationFrameId = requestAnimationFrame(animate);
    return;
  }

  const deltaTime =
    lastTime < 0
      ? 0
      : Math.min((time - lastTime) / 1000, MAX_FRAME_DELTA_SECONDS);
  lastTime = time;

  updateSquares(
    context.value!,
    gridParams.value!.rows,
    gridParams.value!.squares,
    gridParams.value!.dpr,
    deltaTime,
  );
  animationFrameId = requestAnimationFrame(animate);
}

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return;
  context.value = canvasRef.value.getContext("2d")!;
  if (!context.value) return;

  updateCanvasSize();

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    resizeObserver.observe(containerRef.value);
  }

  if (typeof IntersectionObserver !== "undefined") {
    intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isInView.value = entry?.isIntersecting ?? false;
        animationFrameId = requestAnimationFrame(animate);
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(canvasRef.value);
  } else {
    isInView.value = true;
    animationFrameId = requestAnimationFrame(animate);
  }
});

onBeforeUnmount(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  resizeObserver?.disconnect();
  intersectionObserver?.disconnect();
});
</script>

<template>
  <div ref="containerRef" :class="cn(`h-full w-full`, props.class)">
    <!-- The canvas keeps its own device-pixel size; Vue never resets it, so a
    resize cannot wipe the grid. -->
    <canvas ref="canvasRef" class="pointer-events-none" />
  </div>
</template>
