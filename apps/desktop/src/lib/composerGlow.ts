import { resolveColors, toHex } from "@/lib/themeColors";

/**
 * The light that runs round the session composer while the agent works.
 * This module holds its constants, the messages between the component and
 * the renderer (which runs in a worker when it can), and the pure helpers
 * that measure, seed and pace it.
 */

/** Must match the `leaving` opacity transition in `ProjectComposerGlow.vue`. */
export const COMPOSER_GLOW_FADE_OUT_MS = 900;
/** How long the light takes to grow from a point into a full comet. */
export const COMPOSER_GLOW_ENTER_MS = 1100;
/** Seconds per lap round the outline, before the per-run jitter. */
export const COMPOSER_GLOW_LAP_SECONDS = 6;
/** Strength of the fainter comet on the opposite side of the outline. */
export const COMPOSER_GLOW_COMPANION = 0.35;
/** The longest step, in ms, the motion takes between two frames. */
export const COMPOSER_GLOW_MAX_STEP_MS = 100;
/** How long a disposed worker may take to release its GPU context. */
export const COMPOSER_GLOW_DISPOSE_TIMEOUT_MS = 250;

/**
 * The most room, in CSS px, the light takes on each side of the text box.
 * The top stays under the 32 px gap to the todo and steering cards pinned
 * above the composer, so the light never washes over them.
 */
export const COMPOSER_GLOW_MAX_MARGINS = {
  top: 28,
  right: 64,
  bottom: 36,
  left: 64,
} as const;

/** Each side of the drawing buffer is capped at this many pixels. */
export const COMPOSER_GLOW_MAX_BUFFER_PX = 2048;

/** sRGB in 0-1. */
export type Rgb = [number, number, number];

export interface ComposerGlowMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ComposerGlowGeometry {
  /** Canvas size in CSS px (control border box + margins). */
  width: number;
  height: number;
  /** Drawing-buffer px per CSS px. */
  ratio: number;
  /** The control's border box inside the canvas, CSS px, y down. */
  box: { x: number; y: number; width: number; height: number; radius: number };
  /** Room on each side, CSS px; the shader fades to 0 across it. */
  margins: ComposerGlowMargins;
}

export interface ComposerGlowColors {
  /**
   * Accent, warmer tint (hue toward amber/red) and cooler tint (toward
   * green/blue), for the rim and, in the dark theme, the bloom.
   */
  tints: [Rgb, Rgb, Rgb];
  /**
   * Lighter, more saturated versions of the tints for the haze round the
   * rim on light backgrounds, or null when the tints are grey (Neutral):
   * a grey haze on a light page reads as a drop shadow, so it draws only
   * the rim and its hot spots.
   */
  haze: [Rgb, Rgb, Rgb] | null;
  dark: boolean;
}

export interface ComposerGlowActivity {
  focused: boolean;
  visible: boolean;
}

export interface ComposerGlowSeed {
  /** Seconds per lap round the outline. */
  lapSeconds: number;
  /** Radians: phases of the waves that swell and shrink the comet. */
  waves: [number, number, number];
  noise: [number, number, number, number];
  /** Seconds added to the noise clock, so each run looks different. */
  timeOffset: number;
}

export interface ComposerGlowState {
  geometry: ComposerGlowGeometry;
  colors: ComposerGlowColors;
  activity: ComposerGlowActivity;
  reducedMotion: boolean;
  seed: ComposerGlowSeed;
  /** False while the light is leaving: the comet shrinks away. */
  present: boolean;
}

/** Main thread → renderer. */
export type ComposerGlowMessage =
  | { type: "init"; canvas: OffscreenCanvas; state: ComposerGlowState }
  | { type: "resize"; geometry: ComposerGlowGeometry }
  | { type: "colors"; colors: ComposerGlowColors }
  | { type: "activity"; activity: ComposerGlowActivity }
  | { type: "motion"; reducedMotion: boolean }
  | { type: "presence"; present: boolean }
  | { type: "dispose" };

/** Renderer → main thread. */
export type ComposerGlowEvent =
  | { type: "ready"; api: "webgl2" | "webgl" }
  | { type: "unsupported" }
  /** The first presented frame, once per GL context. */
  | { type: "frame" }
  | { type: "disposed" };

const LAP_JITTER = 0.08;
const TIME_OFFSET_RANGE = 1000;

/**
 * The random part of one run, chosen when the light appears and kept while
 * it fades out and back in, so it never jumps.
 */
export function composerGlowSeed(
  random: () => number = Math.random,
): ComposerGlowSeed {
  const unit = () => Math.min(Math.max(random(), 0), 0.999999);
  const phase = () => unit() * Math.PI * 2;
  return {
    lapSeconds:
      COMPOSER_GLOW_LAP_SECONDS * (1 - LAP_JITTER + 2 * LAP_JITTER * unit()),
    waves: [phase(), phase(), phase()],
    noise: [unit(), unit(), unit(), unit()],
    timeOffset: unit() * TIME_OFFSET_RANGE,
  };
}

/** Where the light is on the outline and how far it has grown. */
export interface ComposerGlowMotion {
  /** The comet's head, 0-1 clockwise from the top centre of the outline. */
  head: number;
  /** 0 (a point, or gone) to 1 (full comet), linear in time. */
  reveal: number;
  /** Seconds of animation so far, for the noise. */
  clock: number;
}

/** The values one frame is drawn with. */
export interface ComposerGlowFrame {
  /** Main and companion comet heads, 0-1 clockwise from the top centre. */
  head: number;
  companionHead: number;
  /** Companion strength. */
  companion: number;
  /** Tail length and core width along the outline, CSS px. */
  tail: number;
  width: number;
  intensity: number;
  level: number;
  /** Eased reveal, 0-1. */
  reveal: number;
}

type GlowBox = ComposerGlowGeometry["box"];

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function boxCorners(box: GlowBox) {
  const radius = Math.max(
    0,
    Math.min(box.radius, box.width / 2, box.height / 2),
  );
  const ex = Math.max(box.width / 2 - radius, 0);
  const ey = Math.max(box.height / 2 - radius, 0);
  return { radius, ex, ey, quarter: ex + (Math.PI / 2) * radius + ey };
}

/** The outline's length in CSS px. */
export function composerGlowPerimeter(box: GlowBox): number {
  return Math.max(4 * boxCorners(box).quarter, 1);
}

/**
 * The midpoint of the text box's bottom-right corner (near Send / Stop) as
 * a fraction of the outline, clockwise from the top centre: the light grows
 * out from there when a run starts.
 */
export function composerGlowEntryPoint(box: GlowBox): number {
  const { radius, ey, quarter } = boxCorners(box);
  if (quarter <= 0) return 0.375;
  return fract((quarter + ey + (Math.PI / 4) * radius) / (4 * quarter));
}

/** The motion at the start of a run: a point at the entry point. */
export function composerGlowStartMotion(box: GlowBox): ComposerGlowMotion {
  return { head: composerGlowEntryPoint(box), reveal: 0, clock: 0 };
}

/**
 * One step of the motion: the reveal grows toward 1 while the light is
 * present and shrinks toward 0 while it leaves, and the head moves
 * clockwise at an even pace along the outline. A step never exceeds
 * COMPOSER_GLOW_MAX_STEP_MS, so a slow frame or a hidden window neither
 * skips the entrance nor makes the comet jump.
 */
export function advanceComposerGlowMotion(
  motion: ComposerGlowMotion,
  dtMs: number,
  present: boolean,
  seed: ComposerGlowSeed,
): ComposerGlowMotion {
  const dt = clamp(
    Number.isFinite(dtMs) ? dtMs : 0,
    0,
    COMPOSER_GLOW_MAX_STEP_MS,
  );
  const raw = present
    ? motion.reveal + dt / COMPOSER_GLOW_ENTER_MS
    : motion.reveal - dt / COMPOSER_GLOW_FADE_OUT_MS;
  // Snap away the rounding left by summing many small steps.
  const reveal = raw >= 1 - 1e-9 ? 1 : raw <= 1e-9 ? 0 : raw;
  const speed = mix(0.45, 1, smoothstep(reveal));
  const lap = Math.max(seed.lapSeconds, 0.1);
  return {
    head: fract(motion.head + (dt / 1000 / lap) * speed),
    reveal,
    clock: motion.clock + dt / 1000,
  };
}

/**
 * A smooth, non-repeating wave in 0-1: three sines at incommensurate rates
 * with the run's phases.
 */
export function composerGlowWave(
  t: number,
  phases: readonly [number, number, number],
): number {
  const sum =
    Math.sin(0.31 * t + phases[0]) +
    0.8 * Math.sin(0.53 * t + phases[1]) +
    0.6 * Math.sin(0.97 * t + phases[2]);
  return clamp(0.5 + sum / 4.8, 0, 1);
}

/**
 * The uniform values for one frame. The path never wobbles; the waves only
 * swell and shrink the comet's tail, width and brightness. `still` draws
 * the full comet where the motion is, for reduced motion.
 */
export function composerGlowFrame(
  motion: ComposerGlowMotion,
  seed: ComposerGlowSeed,
  perimeter: number,
  still: boolean,
): ComposerGlowFrame {
  const reveal = still ? 1 : smoothstep(motion.reveal);
  const t = (still ? 0 : motion.clock) + seed.timeOffset;
  const wave = (rate: number, shift: number) =>
    composerGlowWave(rate * t + shift, seed.waves);
  const tail = clamp(perimeter * mix(0.18, 0.32, wave(1, 0)), 90, 420);
  const width = mix(40, 90, wave(1.13, 17.3));
  const intensity = mix(0.75, 1.25, wave(0.87, 41.9));
  const level = still ? 1 : mix(0.85, 1.05, wave(0.71, 73.1));
  return {
    head: motion.head,
    companionHead: fract(motion.head + 0.5),
    companion: COMPOSER_GLOW_COMPANION * reveal * reveal,
    tail: tail * reveal,
    width: width * reveal,
    intensity: intensity * reveal,
    level,
    reveal,
  };
}

export interface GlowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Room on each side of the control, up to the maximum, inside the nearest
 * ancestor that clips it.
 */
export function composerGlowMargins(
  control: GlowRect,
  clip: GlowRect,
): ComposerGlowMargins {
  const room = (available: number, max: number) =>
    Math.min(max, Math.max(0, Math.floor(available)));
  return {
    top: room(control.top - clip.top, COMPOSER_GLOW_MAX_MARGINS.top),
    right: room(clip.right - control.right, COMPOSER_GLOW_MAX_MARGINS.right),
    bottom: room(
      clip.bottom - control.bottom,
      COMPOSER_GLOW_MAX_MARGINS.bottom,
    ),
    left: room(control.left - clip.left, COMPOSER_GLOW_MAX_MARGINS.left),
  };
}

/** Drawing-buffer px per CSS px: about half the device pixels. */
export function composerGlowPixelRatio(devicePixelRatio: number): number {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.min(1, Math.max(0.75, dpr * 0.5));
}

export function composerGlowGeometry(
  control: GlowRect,
  clip: GlowRect,
  radius: number,
  devicePixelRatio: number,
): ComposerGlowGeometry {
  const margins = composerGlowMargins(control, clip);
  const width = Math.max(0, control.right - control.left);
  const height = Math.max(0, control.bottom - control.top);
  return {
    width: width + margins.left + margins.right,
    height: height + margins.top + margins.bottom,
    ratio: composerGlowPixelRatio(devicePixelRatio),
    box: {
      x: margins.left,
      y: margins.top,
      width,
      height,
      radius: Math.max(0, Math.min(radius, width / 2, height / 2)),
    },
    margins,
  };
}

/** Whether two geometries differ by less than `tolerance` CSS px. */
export function composerGlowGeometryEqual(
  a: ComposerGlowGeometry,
  b: ComposerGlowGeometry,
  tolerance = 0.5,
): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < tolerance;
  return (
    a.ratio === b.ratio &&
    near(a.width, b.width) &&
    near(a.height, b.height) &&
    near(a.box.x, b.box.x) &&
    near(a.box.y, b.box.y) &&
    near(a.box.width, b.box.width) &&
    near(a.box.height, b.box.height) &&
    near(a.box.radius, b.box.radius) &&
    near(a.margins.top, b.margins.top) &&
    near(a.margins.right, b.margins.right) &&
    near(a.margins.bottom, b.margins.bottom) &&
    near(a.margins.left, b.margins.left)
  );
}

export function composerGlowColorsEqual(
  a: ComposerGlowColors,
  b: ComposerGlowColors,
): boolean {
  const same = (x: [Rgb, Rgb, Rgb], y: [Rgb, Rgb, Rgb]) =>
    x.every((tint, index) =>
      tint.every((channel, c) => channel === y[index][c]),
    );
  return (
    a.dark === b.dark &&
    same(a.tints, b.tints) &&
    (a.haze === null || b.haze === null
      ? a.haze === b.haze
      : same(a.haze, b.haze))
  );
}

/**
 * Milliseconds between frames, `"static"` for one still frame redrawn only
 * when something changes, or null to draw nothing (hidden window). The
 * main-thread fallback runs at half the worker's rate.
 */
export function composerGlowFrameInterval(
  activity: ComposerGlowActivity,
  reducedMotion: boolean,
  host: "worker" | "main",
): number | "static" | null {
  if (!activity.visible) return null;
  if (reducedMotion) return "static";
  const fps = host === "worker" ? 60 : 30;
  return 1000 / (activity.focused ? fps : fps / 2);
}

/** `#rrggbb` (or `#rgb`) as sRGB in 0-1, or null. */
export function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((digit) => digit + digit)
      .join("");
  return [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  ) as Rgb;
}

/** The light theme's olive tints, for when the tokens cannot be resolved. */
export const COMPOSER_GLOW_DEFAULT_TINTS: [Rgb, Rgb, Rgb] = [
  [0.575, 0.545, 0],
  [0.645, 0.437, 0],
  [0.403, 0.651, 0.252],
];

/** The light theme's olive haze, for when the tokens cannot be resolved. */
export const COMPOSER_GLOW_DEFAULT_HAZE: [Rgb, Rgb, Rgb] = [
  [0.851, 0.796, 0.255],
  [0.976, 0.725, 0.329],
  [0.643, 0.902, 0.459],
];

const TINT_TOKENS = {
  accent: "--composer-glow-color",
  warm: "--composer-glow-color-warm",
  cool: "--composer-glow-color-cool",
  hazeAccent: "--composer-glow-haze",
  hazeWarm: "--composer-glow-haze-warm",
  hazeCool: "--composer-glow-haze-cool",
} as const;

/** True when every tint is grey, as with the Neutral theme. */
export function composerGlowTintsAreGrey(tints: readonly Rgb[]): boolean {
  return tints.every((tint) => Math.max(...tint) - Math.min(...tint) < 0.02);
}

/** The light's tints from the current theme's tokens. */
export function readComposerGlowColors(element: Element): ComposerGlowColors {
  const dark = document.documentElement.classList.contains("dark");
  let resolved: Record<keyof typeof TINT_TOKENS, string> | undefined;
  try {
    resolved = resolveColors(TINT_TOKENS, element);
  } catch {
    resolved = undefined;
  }
  const read = (
    keys: readonly (keyof typeof TINT_TOKENS)[],
    fallback: [Rgb, Rgb, Rgb],
  ) =>
    keys.map((key, index) => {
      const value = resolved?.[key];
      let rgb: Rgb | null = null;
      if (value) {
        try {
          rgb = parseHexColor(toHex(value));
        } catch {
          rgb = null;
        }
      }
      return rgb ?? fallback[index];
    }) as [Rgb, Rgb, Rgb];
  const tints = read(["accent", "warm", "cool"], COMPOSER_GLOW_DEFAULT_TINTS);
  const haze = composerGlowTintsAreGrey(tints)
    ? null
    : read(["hazeAccent", "hazeWarm", "hazeCool"], COMPOSER_GLOW_DEFAULT_HAZE);
  return { tints, haze, dark };
}

/** The nearest ancestor that clips `element`, or the root element. */
export function findClipAncestor(element: Element): Element {
  for (
    let current = element.parentElement;
    current && current !== document.documentElement;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current);
    const clips = (overflow: string) =>
      overflow !== "" && overflow !== "visible";
    if (
      clips(style.overflowX) ||
      clips(style.overflowY) ||
      clips(style.overflow)
    )
      return current;
  }
  return document.documentElement;
}
