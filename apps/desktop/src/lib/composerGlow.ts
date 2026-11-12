/**
 * Timing for the glow that orbits the session composer while the agent
 * works. Must match the `leaving` opacity transition in
 * `ProjectComposerGlow.vue`.
 */
export const COMPOSER_GLOW_FADE_OUT_MS = 900;

/**
 * Base periods in seconds for the CSS opacity animations. They are mutually
 * non-commensurate with each other and with the orbits, so the combined
 * motion never visibly repeats.
 */
const COMPOSER_GLOW_TIMINGS = [
  ["breathe", "delay-breathe", 6.1],
  ["pulse", "delay-pulse", 4.3],
] as const;

/** Base lap times in seconds for the two lights travelling the outline. */
const COMPOSER_GLOW_ORBIT_PERIODS = [9.7, 14.3] as const;
/** Control points of each orbit's speed and wobble noise, per lap. */
const ORBIT_WARP_POINTS = [5, 7] as const;
const ORBIT_WOBBLE_POINTS = [7, 5] as const;

const JITTER = 0.15;
/** Speed varies by up to ±30% along a lap. */
const SPEED_WARP = 0.3;
/** Pixels a light strays across the outline, either way. */
const WOBBLE_PX = 1.5;
const EDGE_STEPS = 4;
const ARC_STEPS = 6;

function seconds(value: number): string {
  return `${Number(value.toFixed(3))}s`;
}

function jittered(base: number, random: () => number): number {
  return base * (1 - JITTER + 2 * JITTER * random());
}

/**
 * Per-mount CSS custom properties: each period is jittered by up to ±15% and
 * starts at a random phase (a negative delay), so every run moves
 * differently. Written once per mount; nothing runs per frame.
 */
export function composerGlowStyle(
  random: () => number = Math.random,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [durationName, delayName, base] of COMPOSER_GLOW_TIMINGS) {
    const duration = jittered(base, random);
    const delay = -duration * random();
    style[`--composer-glow-${durationName}`] = seconds(duration);
    style[`--composer-glow-${delayName}`] = seconds(delay);
  }
  return style;
}

/** One light's lap: its timing and the noise that makes it uneven. */
export interface ComposerGlowOrbit {
  durationMs: number;
  /** Negative, so the lap starts at a random point. */
  delayMs: number;
  /** Values in [-1, 1], spread evenly over a lap: speed changes. */
  warp: number[];
  /** Values in [-1, 1], spread evenly over a lap: sideways stray. */
  wobble: number[];
}

/**
 * The random part of one run, chosen once when the glow appears and kept
 * when the composer resizes so a resize does not visibly jump.
 */
export function composerGlowOrbits(
  random: () => number = Math.random,
): ComposerGlowOrbit[] {
  return COMPOSER_GLOW_ORBIT_PERIODS.map((base, index) => {
    const durationMs = Math.round(jittered(base, random) * 1000);
    const noise = (count: number) =>
      Array.from({ length: count }, () => 2 * random() - 1);
    return {
      durationMs,
      delayMs: -Math.round(durationMs * random()),
      warp: noise(ORBIT_WARP_POINTS[index]),
      wobble: noise(ORBIT_WOBBLE_POINTS[index]),
    };
  });
}

/** The rounded rectangle the lights travel, in their positioning frame. */
export interface ComposerGlowOutline {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * The centre line of the glow ring. `clientWidth`/`clientHeight` are the
 * ring's padding box (the text box's border box), `spread` its border width
 * and `outerRadius` its outer corner radius. Returns null while it has no
 * size.
 */
export function composerGlowOutline(ring: {
  clientWidth: number;
  clientHeight: number;
  spread: number;
  outerRadius: number;
}): ComposerGlowOutline | null {
  const width = ring.clientWidth + ring.spread;
  const height = ring.clientHeight + ring.spread;
  if (!(width > 0 && height > 0)) return null;
  return {
    x: -ring.spread / 2,
    y: -ring.spread / 2,
    width,
    height,
    radius: ring.outerRadius - ring.spread / 2,
  };
}

interface PathPoint {
  x: number;
  y: number;
  /** Direction of travel in degrees, clockwise from the +x axis. */
  angle: number;
}

/** Clockwise points round the outline, starting where the top edge starts. */
function outlinePoints(outline: ComposerGlowOutline): PathPoint[] {
  const { x, y, width: w, height: h } = outline;
  const r = Math.min(Math.max(outline.radius, 0), w / 2, h / 2);
  const points: PathPoint[] = [];
  const edge = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    angle: number,
  ) => {
    for (let step = 0; step < EDGE_STEPS; step += 1) {
      const t = step / EDGE_STEPS;
      points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, angle });
    }
  };
  const arc = (cx: number, cy: number, from: number) => {
    for (let step = 0; step < ARC_STEPS; step += 1) {
      const degrees = from + (90 * step) / ARC_STEPS;
      const radians = (degrees * Math.PI) / 180;
      points.push({
        x: cx + r * Math.cos(radians),
        y: cy + r * Math.sin(radians),
        angle: degrees + 90,
      });
    }
  };
  edge(x + r, y, x + w - r, y, 0);
  arc(x + w - r, y + r, -90);
  edge(x + w, y + r, x + w, y + h - r, 90);
  arc(x + w - r, y + h - r, 0);
  edge(x + w - r, y + h, x + r, y + h, 180);
  arc(x + r, y + h - r, 90);
  edge(x, y + h - r, x, y + r, 270);
  arc(x + r, y + r, 180);
  points.push({ ...points[0], angle: 360 });
  return points;
}

/** Cyclic linear interpolation of evenly spaced control points. */
function noiseAt(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const position = (((fraction % 1) + 1) % 1) * values.length;
  const index = Math.floor(position);
  const t = position - index;
  const a = values[index % values.length];
  const b = values[(index + 1) % values.length];
  return a * (1 - t) + b * t;
}

function px(value: number): string {
  return `${Number(value.toFixed(2))}px`;
}

/**
 * Keyframes that carry a light once round the outline. Offsets follow arc
 * length, so the light keeps a near-even pace along edges and corners alike,
 * bent only by the orbit's speed noise. The light also turns to follow the
 * outline and strays slightly across it. Computed once per size, never per
 * frame.
 */
export function composerGlowKeyframes(
  outline: ComposerGlowOutline,
  orbit: Pick<ComposerGlowOrbit, "warp" | "wobble">,
): Keyframe[] {
  const points = outlinePoints(outline);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    lengths.push(lengths[index - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) return [];

  const times = [0];
  for (let index = 1; index < points.length; index += 1) {
    const segment = lengths[index] - lengths[index - 1];
    const middle = (lengths[index] + lengths[index - 1]) / 2 / total;
    const speed = 1 + SPEED_WARP * noiseAt(orbit.warp, middle);
    times.push(times[index - 1] + segment / speed);
  }
  const duration = times[times.length - 1];

  return points.map((point, index) => {
    const along = lengths[index] / total;
    const stray = WOBBLE_PX * noiseAt(orbit.wobble, along);
    const radians = (point.angle * Math.PI) / 180;
    // Outward normal of clockwise travel with y pointing down.
    const nx = Math.sin(radians);
    const ny = -Math.cos(radians);
    return {
      offset: index === points.length - 1 ? 1 : times[index] / duration,
      transform: `translate(${px(point.x + nx * stray)}, ${px(
        point.y + ny * stray,
      )}) rotate(${Number(point.angle.toFixed(2))}deg)`,
    };
  });
}
