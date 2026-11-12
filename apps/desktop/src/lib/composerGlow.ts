/**
 * Timing for the glow that orbits the session composer while the agent
 * works. Must match the `leaving` opacity transition in
 * `ProjectComposerGlow.vue`.
 */
export const COMPOSER_GLOW_FADE_OUT_MS = 900;

/**
 * Base periods in seconds. They are mutually non-commensurate, so the
 * combined motion never visibly repeats.
 */
const COMPOSER_GLOW_TIMINGS = [
  ["spin-a", "delay-a", 9.7],
  ["spin-b", "delay-b", 14.3],
  ["drift", "delay-drift", 17.9],
  ["breathe", "delay-breathe", 6.1],
  ["pulse", "delay-pulse", 4.3],
] as const;

const JITTER = 0.15;

function seconds(value: number): string {
  return `${Number(value.toFixed(3))}s`;
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
    const duration = base * (1 - JITTER + 2 * JITTER * random());
    const delay = -duration * random();
    style[`--composer-glow-${durationName}`] = seconds(duration);
    style[`--composer-glow-${delayName}`] = seconds(delay);
  }
  return style;
}
