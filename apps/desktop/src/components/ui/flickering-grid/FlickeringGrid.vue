<script lang="ts" setup>
import { cn } from "@/lib/utils";
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from "vue";
import { createHdrOverlay, type HdrOverlay } from "./hdrOverlay";
import type { FlickeringGridShape } from "./types";

interface FlickeringGridProps {
  squareSize?: number;
  gridGap?: number;
  flickerChance?: number;
  color?: string;
  width?: number;
  height?: number;
  class?: string;
  maxOpacity?: number;
  shape?: FlickeringGridShape;
  shapeMinOpacity?: number;
  shapeMaxOpacity?: number;
  /** Fades the flickering cells toward the edges, like a centred elliptical
   * radial gradient that reaches nothing at this share of its farthest-corner
   * radius. Shape cells keep their full strength. */
  vignette?: number;
  /** Share of their strength ripples and flashes keep where the vignette has
   * faded the flicker to nothing; 1 leaves them unfaded. */
  rippleVignetteFloor?: number;
  /** Peak opacity a click ripple lifts its cells to. */
  rippleOpacity?: number;
  /** Colour of the light ripples add; defaults to `color`. */
  rippleColor?: string;
  /** How many times brighter than SDR white ripples and flashes may glow on
   * an HDR display; 1 keeps them in SDR. */
  rippleHdrGain?: number;
}

const props = withDefaults(defineProps<FlickeringGridProps>(), {
  squareSize: 4,
  gridGap: 6,
  flickerChance: 0.3,
  color: "rgb(0, 0, 0)",
  maxOpacity: 0.3,
  shapeMinOpacity: 0.6,
  shapeMaxOpacity: 1,
  rippleOpacity: 0.8,
  rippleHdrGain: 1,
  rippleVignetteFloor: 1,
});

const {
  squareSize,
  gridGap,
  flickerChance,
  color,
  maxOpacity,
  width,
  height,
  shape,
  shapeMinOpacity,
  shapeMaxOpacity,
  rippleOpacity,
  rippleColor,
  rippleHdrGain,
  rippleVignetteFloor,
  vignette,
} = toRefs(props);

const containerRef = ref<HTMLDivElement>();
const canvasRef = ref<HTMLCanvasElement>();
const rippleCanvasRef = ref<HTMLCanvasElement>();
const hdrCanvasRef = ref<HTMLCanvasElement>();
const usesHdr = computed(() => rippleHdrGain.value > 1);

/** Lifts the ripples' own light into HDR; the ripple layer below stays as
 * the SDR rendering for displays without headroom. The source holds only the
 * light the ripples add, so dots they merely carry never glow. */
let hdrOverlay: HdrOverlay | undefined;
let hdrSource: HTMLCanvasElement | undefined;
const context = ref<CanvasRenderingContext2D>();

const isInView = ref(false);

/** The grid only redraws the cells that actually flickered, and only at this
 * rate: repainting every square every frame is what kept a background
 * decoration pegged to a full CPU core. */
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_FRAME_DELTA_SECONDS = 0.05;

/** Resolves a colour, reading a bare `var(--name)` from the container. */
function resolveColor(value: string): string {
  const cssVariable = value.match(/^var\((--[^)]+)\)$/)?.[1];
  if (!cssVariable || !containerRef.value) return value;

  return (
    getComputedStyle(containerRef.value).getPropertyValue(cssVariable).trim() ||
    value
  );
}

/** Bumped when the root element's class or style changes, which is how the
 * app switches colour schemes, so `var(--name)` colours resolve again. */
const colorVersion = ref(0);
let colorObserver: MutationObserver | undefined;

const computedColor = computed(() => {
  void colorVersion.value;
  if (!context.value) return "transparent";
  return resolveColor(color.value);
});

const computedRippleColor = computed(() => {
  void colorVersion.value;
  if (!context.value) return "transparent";
  return resolveColor(rippleColor.value ?? color.value);
});

/** Repaints the grid in its new colour, keeping every cell's opacity. */
watch(computedColor, () => {
  const params = gridParams.value;
  if (!params || !context.value || !canvasRef.value) return;
  drawGrid(
    context.value,
    canvasRef.value,
    params.cols,
    params.rows,
    params.squares,
    params.dpr,
  );
});

/** Whether the shape covers each cell, as 0 or 1, indexed like the squares.
 * The shape is rasterised at one pixel per cell and its antialiased coverage
 * thresholded at half, since partly lit edge cells blur a mark this coarse. */
let shapeWeights: Float32Array | undefined;

function sampleShape(cols: number, rows: number): Float32Array | undefined {
  const target = shape.value;
  if (!target || !cols || !rows || typeof Path2D === "undefined") return;

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const pitch = squareSize.value + gridGap.value;
  const scaleX = target.width / target.viewBox.width / pitch;
  const scaleY = target.height / target.viewBox.height / pitch;
  ctx.setTransform(
    scaleX,
    0,
    0,
    scaleY,
    target.x / pitch - target.viewBox.x * scaleX,
    target.y / pitch - target.viewBox.y * scaleY,
  );
  ctx.fill(new Path2D(target.path));

  const pixels = ctx.getImageData(0, 0, cols, rows).data;
  const weights = new Float32Array(cols * rows);
  for (let index = 0; index < weights.length; index++) {
    const col = Math.floor(index / rows);
    const row = index % rows;
    weights[index] = (pixels[(row * cols + col) * 4 + 3] ?? 0) >= 128 ? 1 : 0;
  }
  return weights;
}

/** Each cell's share of the flicker's strength under the vignette, indexed
 * like the squares. Fading the cells themselves, rather than the whole layer,
 * leaves the shape, ripples and flashes free to reach full opacity. */
let vignetteWeights: Float32Array | undefined;

function sampleVignette(
  cols: number,
  rows: number,
  width: number,
  height: number,
): Float32Array | undefined {
  const extent = vignette.value;
  if (!extent) return;
  const pitch = squareSize.value + gridGap.value;
  // An ellipse sized to its farthest corner has radii of √2 times each half.
  const radiusX = (width / 2) * Math.SQRT2;
  const radiusY = (height / 2) * Math.SQRT2;
  const weights = new Float32Array(cols * rows);
  for (let index = 0; index < weights.length; index++) {
    const x = Math.floor(index / rows) * pitch + squareSize.value / 2;
    const y = (index % rows) * pitch + squareSize.value / 2;
    const distance = Math.hypot(
      (x - width / 2) / radiusX,
      (y - height / 2) / radiusY,
    );
    weights[index] = Math.max(0, 1 - distance / extent);
  }
  return weights;
}

/** How much of a ripple's strength reaches a cell: the vignette, squared so
 * it falls away quickly from the centre, with the faded edges still keeping
 * `rippleVignetteFloor` of it. */
function rippleVignette(index: number): number {
  const weight = (vignetteWeights?.[index] ?? 1) ** 2;
  const floor = rippleVignetteFloor.value;
  return floor + (1 - floor) * weight;
}

/** A fresh opacity for a cell, from the shape's range when the shape covers
 * it. */
function randomOpacity(index: number): number {
  if (shapeWeights?.[index]) {
    return (
      shapeMinOpacity.value +
      Math.random() * (shapeMaxOpacity.value - shapeMinOpacity.value)
    );
  }
  return Math.random() * maxOpacity.value * (vignetteWeights?.[index] ?? 1);
}

const RIPPLE_DURATION_MS = 1400;
const RIPPLE_MAX_RADIUS_PX = 420;
/** Each ripple spreads to a random share of the maximum radius, within
 * ±this. */
const RIPPLE_RADIUS_JITTER = 0.3;
/** The burst of light where the press landed, before the ring outgrows it. */
const RIPPLE_FLASH_DURATION_MS = 550;
const RIPPLE_FLASH_RADIUS_PITCHES = 7;
const RIPPLE_FLASH_OPACITY = 1;
/** Share of the ripple's life it holds full strength before fading. */
const RIPPLE_FADE_START = 0.35;
/** How much wider the ring grows, as a share of its band, while it fades. */
const RIPPLE_FADE_SPREAD = 0.6;
/** How far, in grid pitches, the ring pushes dots ahead of it outward and
 * pulls dots behind it inward, bunching them at its crest. */
const RIPPLE_PUSH_PITCHES = 1.5;
/** Half the ring's thickness, in grid pitches, before its own wobble. */
const RIPPLE_BAND_PITCHES = 5;

/** Angular harmonics that wobble a ripple's ring, as the share of the radius
 * each one bends it and how fast, in radians per second, its phase drifts. */
const RIPPLE_WOBBLES = [
  { frequency: 3, amplitude: 0.07, drift: 1.1 },
  { frequency: 5, amplitude: 0.04, drift: -1.7 },
  { frequency: 8, amplitude: 0.02, drift: 2.3 },
] as const;
/** Harmonics that swell and thin the ring along its length, as the share of
 * the band's thickness each one adds or takes away. */
const RIPPLE_BAND_WOBBLES = [
  { frequency: 2, amplitude: 0.35, drift: -0.9 },
  { frequency: 4, amplitude: 0.2, drift: 1.6 },
  { frequency: 7, amplitude: 0.1, drift: -2.6 },
] as const;

function maxWobble(wobbles: readonly { amplitude: number }[]): number {
  return wobbles.reduce((total, wobble) => total + wobble.amplitude, 0);
}

const RIPPLE_MAX_WOBBLE = maxWobble(RIPPLE_WOBBLES);
const RIPPLE_MAX_BAND_WOBBLE = maxWobble(RIPPLE_BAND_WOBBLES);

interface Ripple {
  x: number;
  y: number;
  /** A random starting phase per wobble, so no two ripples share a shape. */
  phases: number[];
  bandPhases: number[];
  /** How far this ripple spreads, in CSS pixels. */
  maxRadius: number;
  /** requestAnimationFrame time of the first frame that drew it. */
  start?: number;
}

/** Bursts out and settles slowly, for the ring's spread. */
function easeOutExpo(progress: number): number {
  return progress >= 1 ? 1 : 1 - 2 ** (-10 * progress);
}

/** How much of its strength a ripple keeps: all of it at first, then a smooth
 * fall to none. */
function rippleFade(progress: number): number {
  const t = Math.min(
    1,
    Math.max(0, (progress - RIPPLE_FADE_START) / (1 - RIPPLE_FADE_START)),
  );
  return 1 - t * t * (3 - 2 * t);
}

/** The factor a set of wobbles scales a length by toward an angle. */
function wobbleFactor(
  wobbles: readonly { frequency: number; amplitude: number; drift: number }[],
  phases: number[],
  angle: number,
  seconds: number,
): number {
  let factor = 1;
  wobbles.forEach(({ frequency, amplitude, drift }, index) => {
    const phase = (phases[index] ?? 0) + drift * seconds;
    factor += amplitude * Math.sin(frequency * angle + phase);
  });
  return factor;
}

let ripples: Ripple[] = [];

/** Angles each frame samples a ripple's wobbles at; cells interpolate
 * between them instead of evaluating every harmonic themselves. */
const RIPPLE_ANGLE_SAMPLES = 512;
const rippleRingTable = new Float32Array(RIPPLE_ANGLE_SAMPLES + 1);
const rippleThicknessTable = new Float32Array(RIPPLE_ANGLE_SAMPLES + 1);

/** The cells the ripples currently reach. They leave the grid canvas, since a
 * moved dot spills out of its cell, and the ripple layer draws them instead:
 * a cell shows the brighter of its lift and its own flicker, except shape
 * cells, which the ripples darken into negative space.
 *
 * Membership is a frame stamp per cell, and each cell's lift and push live in
 * typed arrays, so a frame allocates nothing per cell. */
let rippleFrame = 1;
let rippleStamps = new Uint32Array(0);
/** The opacity the ripples lift each dot to. */
let rippleOpacities = new Float32Array(0);
/** How far the ripples have pushed each dot, in CSS pixels. */
let rippleShiftsX = new Float32Array(0);
let rippleShiftsY = new Float32Array(0);
let rippleCells: number[] = [];

function isRippleCell(index: number): boolean {
  return rippleStamps[index] === rippleFrame;
}

interface DeviceBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the ripple layer and HDR source last drew, so the next frame clears
 * only that instead of the whole canvas. */
let rippleLayerBox: DeviceBox | undefined;
let hdrSourceBox: DeviceBox | undefined;

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

  shapeWeights = sampleShape(cols, rows);
  vignetteWeights = sampleVignette(cols, rows, width, height);
  ripples = [];
  rippleFrame = 1;
  rippleStamps = new Uint32Array(cols * rows);
  rippleOpacities = new Float32Array(cols * rows);
  rippleShiftsX = new Float32Array(cols * rows);
  rippleShiftsY = new Float32Array(cols * rows);
  rippleCells = [];
  const layer = rippleCanvasRef.value;
  layer?.getContext("2d")?.clearRect(0, 0, layer.width, layer.height);
  rippleLayerBox = undefined;
  hdrSource
    ?.getContext("2d")
    ?.clearRect(0, 0, hdrSource.width, hdrSource.height);
  hdrSourceBox = undefined;
  hdrOverlay?.clear();
  const squares = new Float32Array(cols * rows);
  for (let i = 0; i < squares.length; i++) {
    squares[i] = randomOpacity(i);
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
  const opacity = squares[index] ?? 0;
  if (opacity <= 0 || isRippleCell(index)) return;
  const pitch = (squareSize.value + gridGap.value) * dpr;
  const size = squareSize.value * dpr;
  ctx.globalAlpha = opacity;
  ctx.fillRect(
    Math.floor(index / rows) * pitch,
    (index % rows) * pitch,
    size,
    size,
  );
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

  // Each cell flickers with probability `chance`, so the gaps between
  // flickering cells are geometric: jumping straight to the next one draws the
  // same pattern with a random number per flicker instead of one per cell.
  const logMiss = chance < 1 ? Math.log(1 - chance) : -Infinity;
  const gap = () => Math.floor(Math.log(1 - Math.random()) / logMiss);
  for (let index = gap(); index < squares.length; index += 1 + gap()) {
    squares[index] = randomOpacity(index);
    repaintCell(ctx, rows, squares, dpr, index);
  }
  ctx.globalAlpha = 1;
}

/** Samples a set of wobbles around the circle into `table`, scaled by
 * `length`. */
function fillWobbleTable(
  table: Float32Array,
  wobbles: readonly { frequency: number; amplitude: number; drift: number }[],
  phases: number[],
  length: number,
  seconds: number,
) {
  for (let sample = 0; sample <= RIPPLE_ANGLE_SAMPLES; sample++) {
    const angle = (sample / RIPPLE_ANGLE_SAMPLES) * Math.PI * 2 - Math.PI;
    table[sample] = length * wobbleFactor(wobbles, phases, angle, seconds);
  }
}

/** Reads a wobble table at an angle from `Math.atan2`, interpolating. */
function readWobbleTable(table: Float32Array, angle: number): number {
  const position = ((angle + Math.PI) / (Math.PI * 2)) * RIPPLE_ANGLE_SAMPLES;
  const sample = Math.min(RIPPLE_ANGLE_SAMPLES - 1, Math.floor(position));
  const share = position - sample;
  return table[sample]! + (table[sample + 1]! - table[sample]!) * share;
}

/** Advances every ripple's ring and repaints the cells it entered or left. */
function updateRipples(
  ctx: CanvasRenderingContext2D,
  cols: number,
  rows: number,
  squares: Float32Array,
  dpr: number,
  time: number,
) {
  if (!ripples.length && !rippleCells.length) return;

  const pitch = squareSize.value + gridGap.value;
  const half = squareSize.value / 2;
  const band = RIPPLE_BAND_PITCHES * pitch;
  const push = RIPPLE_PUSH_PITCHES * pitch;
  const previousCells = rippleCells;
  const previousFrame = rippleFrame;
  const frame = previousFrame + 1;
  const cells: number[] = [];
  const entered: number[] = [];
  /** Folds one ripple's effect on a cell into the frame's: the brightest lift
   * wins and the pushes add up. */
  function affect(index: number, opacity: number, dx: number, dy: number) {
    if (rippleStamps[index] === frame) {
      rippleOpacities[index] = Math.max(rippleOpacities[index]!, opacity);
      rippleShiftsX[index]! += dx;
      rippleShiftsY[index]! += dy;
      return;
    }
    if (rippleStamps[index] !== previousFrame) entered.push(index);
    rippleStamps[index] = frame;
    rippleOpacities[index] = opacity;
    rippleShiftsX[index] = dx;
    rippleShiftsY[index] = dy;
    cells.push(index);
  }
  /** Visits the rows of one column whose centres lie between two offsets
   * from the ripple's centre row. */
  function eachRow(from: number, to: number, visit: (row: number) => void) {
    const first = Math.max(0, Math.ceil((from - half) / pitch));
    const last = Math.min(rows - 1, Math.floor((to - half) / pitch));
    for (let row = first; row <= last; row++) visit(row);
  }

  ripples = ripples.filter((ripple) => {
    ripple.start ??= time;
    const elapsed = time - ripple.start;
    if (elapsed >= RIPPLE_DURATION_MS) return false;

    const seconds = elapsed / 1000;
    const progress = elapsed / RIPPLE_DURATION_MS;
    const radius = ripple.maxRadius * easeOutExpo(progress);
    const fade = rippleFade(progress);
    const peak = rippleOpacity.value * fade;
    // The ring loosens as it fades, so it dissipates rather than just dims.
    const spread = band * (1 + RIPPLE_FADE_SPREAD * (1 - fade));

    // The flash fades fast from full, so the press reads as a sudden burst.
    const flashRadius = RIPPLE_FLASH_RADIUS_PITCHES * pitch;
    const flashProgress = elapsed / RIPPLE_FLASH_DURATION_MS;
    const flash =
      flashProgress < 1 ? RIPPLE_FLASH_OPACITY * (1 - flashProgress) ** 2 : 0;
    if (flash) {
      const firstCol = Math.max(
        0,
        Math.ceil((ripple.x - flashRadius - half) / pitch),
      );
      const lastCol = Math.min(
        cols - 1,
        Math.floor((ripple.x + flashRadius - half) / pitch),
      );
      for (let col = firstCol; col <= lastCol; col++) {
        const dx = col * pitch + half - ripple.x;
        const reach = Math.sqrt(Math.max(0, flashRadius ** 2 - dx * dx));
        eachRow(ripple.y - reach, ripple.y + reach, (row) => {
          const dy = row * pitch + half - ripple.y;
          const distance = Math.hypot(dx, dy);
          if (distance >= flashRadius) return;
          const index = col * rows + row;
          // Near full across most of the burst, falling off only at its rim.
          const opacity =
            flash * (1 - (distance / flashRadius) ** 2) * rippleVignette(index);
          affect(index, opacity, 0, 0);
        });
      }
    }

    fillWobbleTable(
      rippleRingTable,
      RIPPLE_WOBBLES,
      ripple.phases,
      radius,
      seconds,
    );
    fillWobbleTable(
      rippleThicknessTable,
      RIPPLE_BAND_WOBBLES,
      ripple.bandPhases,
      spread,
      seconds,
    );
    // Only the annulus the wobbling ring can reach is visited.
    const widest = spread * (1 + RIPPLE_MAX_BAND_WOBBLE);
    const outer = radius * (1 + RIPPLE_MAX_WOBBLE) + widest;
    const inner = Math.max(0, radius * (1 - RIPPLE_MAX_WOBBLE) - widest);
    const visit = (col: number, dx: number) => (row: number) => {
      const dy = row * pitch + half - ripple.y;
      const distance = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const thickness = readWobbleTable(rippleThicknessTable, angle);
      const signedOffset = distance - readWobbleTable(rippleRingTable, angle);
      const offset = Math.abs(signedOffset);
      if (offset >= thickness) return;
      const index = col * rows + row;
      const vignetteShare = rippleVignette(index);
      const opacity = peak * (1 - offset / thickness) * vignetteShare;
      // Outward ahead of the crest, inward behind it.
      const shove =
        push *
        Math.sin((Math.PI * signedOffset) / thickness) *
        fade *
        vignetteShare;
      const unitX = distance ? dx / distance : 0;
      const unitY = distance ? dy / distance : 0;
      affect(index, opacity, unitX * shove, unitY * shove);
    };
    const firstCol = Math.max(0, Math.ceil((ripple.x - outer - half) / pitch));
    const lastCol = Math.min(
      cols - 1,
      Math.floor((ripple.x + outer - half) / pitch),
    );
    for (let col = firstCol; col <= lastCol; col++) {
      const dx = col * pitch + half - ripple.x;
      const reach = Math.sqrt(Math.max(0, outer * outer - dx * dx));
      const visitRow = visit(col, dx);
      if (Math.abs(dx) < inner) {
        const hole = Math.sqrt(inner * inner - dx * dx);
        eachRow(ripple.y - reach, ripple.y - hole, visitRow);
        eachRow(ripple.y + hole, ripple.y + reach, visitRow);
      } else {
        eachRow(ripple.y - reach, ripple.y + reach, visitRow);
      }
    }
    return true;
  });

  // The grid only repaints cells entering or leaving the ripples: entering
  // clears them for the ripple layer, leaving puts them back.
  rippleFrame = frame;
  rippleCells = cells;
  ctx.fillStyle = computedColor.value;
  for (const index of previousCells) {
    if (rippleStamps[index] !== frame) {
      repaintCell(ctx, rows, squares, dpr, index);
    }
  }
  for (const index of entered) repaintCell(ctx, rows, squares, dpr, index);
  ctx.globalAlpha = 1;
  drawRippleLayers(rows, squares, dpr);
}

/** Sizes a ripple canvas to match the grid's. */
function matchGridSize(canvas: HTMLCanvasElement, grid: HTMLCanvasElement) {
  if (canvas.width !== grid.width || canvas.height !== grid.height) {
    canvas.width = grid.width;
    canvas.height = grid.height;
  }
  canvas.style.width = grid.style.width;
  canvas.style.height = grid.style.height;
}

/** Grows a box to cover a rectangle. */
function coverRect(
  box: DeviceBox | undefined,
  left: number,
  top: number,
  size: number,
): DeviceBox {
  if (!box) return { left, top, right: left + size, bottom: top + size };
  box.left = Math.min(box.left, left);
  box.top = Math.min(box.top, top);
  box.right = Math.max(box.right, left + size);
  box.bottom = Math.max(box.bottom, top + size);
  return box;
}

/** Clears a box, padded to whole pixels, from a canvas. */
function clearBox(ctx: CanvasRenderingContext2D, box: DeviceBox | undefined) {
  if (!box) return;
  const left = Math.floor(box.left) - 1;
  const top = Math.floor(box.top) - 1;
  ctx.clearRect(
    left,
    top,
    Math.ceil(box.right) + 1 - left,
    Math.ceil(box.bottom) + 1 - top,
  );
}

let rippleLayerCtx: CanvasRenderingContext2D | null | undefined;
let hdrSourceCtx: CanvasRenderingContext2D | null | undefined;

/** Redraws the ripple cells at their pushed positions: the full dot on the
 * SDR ripple layer, and only the ripples' added light on the HDR source. Each
 * canvas clears just where it drew last frame. */
function drawRippleLayers(rows: number, squares: Float32Array, dpr: number) {
  const grid = canvasRef.value;
  const layer = rippleCanvasRef.value;
  if (!grid || !layer) return;
  rippleLayerCtx ??= layer.getContext("2d");
  const layerCtx = rippleLayerCtx;
  if (!layerCtx) return;
  if (layer.width !== grid.width || layer.height !== grid.height) {
    rippleLayerBox = undefined;
  }
  matchGridSize(layer, grid);
  clearBox(layerCtx, rippleLayerBox);
  rippleLayerBox = undefined;

  let hdrCtx: CanvasRenderingContext2D | null | undefined;
  if (hdrOverlay && usesHdr.value && rippleCells.length) {
    if (!hdrSource) {
      hdrSource = document.createElement("canvas");
      hdrSourceCtx = hdrSource.getContext("2d");
    }
    if (hdrSource.width !== grid.width || hdrSource.height !== grid.height) {
      hdrSourceBox = undefined;
    }
    matchGridSize(hdrSource, grid);
    hdrCtx = hdrSourceCtx;
    if (hdrCtx) clearBox(hdrCtx, hdrSourceBox);
    hdrSourceBox = undefined;
  }

  const color = computedColor.value;
  const lightColor = computedRippleColor.value;
  if (hdrCtx) hdrCtx.fillStyle = lightColor;
  const peak = Math.max(rippleOpacity.value, Number.EPSILON);
  const pitch = (squareSize.value + gridGap.value) * dpr;
  const size = squareSize.value * dpr;
  for (const index of rippleCells) {
    const left = Math.floor(index / rows) * pitch + rippleShiftsX[index]! * dpr;
    const top = (index % rows) * pitch + rippleShiftsY[index]! * dpr;
    const lift = rippleOpacities[index]!;
    const flicker = squares[index] ?? 0;
    layerCtx.fillStyle = color;
    if (shapeWeights?.[index]) {
      // Where a ripple crosses the shape, the shape gives way to darkness.
      layerCtx.globalAlpha = flicker * (1 - Math.min(1, lift / peak));
      layerCtx.fillRect(left, top, size, size);
      rippleLayerBox = coverRect(rippleLayerBox, left, top, size);
      continue;
    }
    // The dot's own flicker, with the ripple's light over it.
    layerCtx.globalAlpha = flicker;
    layerCtx.fillRect(left, top, size, size);
    if (lift > flicker) {
      layerCtx.fillStyle = lightColor;
      layerCtx.globalAlpha = lift;
      layerCtx.fillRect(left, top, size, size);
      if (hdrCtx) {
        hdrCtx.globalAlpha = lift;
        hdrCtx.fillRect(left, top, size, size);
        hdrSourceBox = coverRect(hdrSourceBox, left, top, size);
      }
    }
    rippleLayerBox = coverRect(rippleLayerBox, left, top, size);
  }
  layerCtx.globalAlpha = 1;

  if (!hdrOverlay) return;
  if (hdrCtx && hdrSource) {
    hdrCtx.globalAlpha = 1;
    hdrOverlay.draw(hdrSource, rippleHdrGain.value, hdrSourceBox);
  } else {
    hdrOverlay.clear();
  }
}

/** Sends a ripple out from a point, in CSS pixels from the grid's top-left
 * corner. Reduced motion skips it. */
function ripple(x: number, y: number) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  ripples.push({
    x,
    y,
    phases: RIPPLE_WOBBLES.map(() => Math.random() * Math.PI * 2),
    bandPhases: RIPPLE_BAND_WOBBLES.map(() => Math.random() * Math.PI * 2),
    maxRadius:
      RIPPLE_MAX_RADIUS_PX *
      (1 + (Math.random() * 2 - 1) * RIPPLE_RADIUS_JITTER),
  });
}

defineExpose({ ripple });

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

/** Moving the shape re-rolls only the cells whose coverage changed, so the
 * rest of the grid keeps flickering undisturbed. */
watch(shape, () => {
  const params = gridParams.value;
  if (!params || !context.value || !canvasRef.value) return;
  const previous = shapeWeights;
  shapeWeights = sampleShape(params.cols, params.rows);
  for (let index = 0; index < params.squares.length; index++) {
    if ((previous?.[index] ?? 0) !== (shapeWeights?.[index] ?? 0)) {
      params.squares[index] = randomOpacity(index);
    }
  }
  drawGrid(
    context.value,
    canvasRef.value,
    params.cols,
    params.rows,
    params.squares,
    params.dpr,
  );
});

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
  updateRipples(
    context.value!,
    gridParams.value!.cols,
    gridParams.value!.rows,
    gridParams.value!.squares,
    gridParams.value!.dpr,
    time,
  );
  animationFrameId = requestAnimationFrame(animate);
}

let isUnmounted = false;

let isCreatingHdrOverlay = false;

/** Sets the HDR overlay up the first time a gain above 1 asks for it. */
function ensureHdrOverlay() {
  if (hdrOverlay || isCreatingHdrOverlay || !hdrCanvasRef.value) return;
  isCreatingHdrOverlay = true;
  void createHdrOverlay(hdrCanvasRef.value).then((overlay) => {
    isCreatingHdrOverlay = false;
    if (isUnmounted) overlay?.destroy();
    else hdrOverlay = overlay;
  });
}

watch(usesHdr, (enabled) => {
  if (enabled) ensureHdrOverlay();
  else hdrOverlay?.clear();
});

onMounted(() => {
  if (usesHdr.value) ensureHdrOverlay();

  if (!canvasRef.value || !containerRef.value) return;
  context.value = canvasRef.value.getContext("2d")!;
  if (!context.value) return;

  updateCanvasSize();

  if (typeof MutationObserver !== "undefined") {
    colorObserver = new MutationObserver(() => {
      colorVersion.value += 1;
    });
    colorObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

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
  isUnmounted = true;
  hdrOverlay?.destroy();
  hdrOverlay = undefined;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  resizeObserver?.disconnect();
  colorObserver?.disconnect();
  intersectionObserver?.disconnect();
});
</script>

<template>
  <div ref="containerRef" :class="cn(`relative h-full w-full`, props.class)">
    <!-- The canvases keep their own device-pixel size; Vue never resets it, so
    a resize cannot wipe the grid. -->
    <canvas ref="canvasRef" class="pointer-events-none" />
    <canvas
      ref="rippleCanvasRef"
      class="pointer-events-none absolute top-0 left-0"
    />
    <!-- Kept mounted so the overlay survives the gain dropping to 1 and back. -->
    <canvas
      ref="hdrCanvasRef"
      class="pointer-events-none absolute top-0 left-0"
    />
  </div>
</template>
