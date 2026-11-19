import type { LiveContextSource } from "@/shared/liveContext";
import type { LiveContextLevelSample } from "@/stores/liveContext";

/** Levels at or below this are silence; speech peaks well above. */
const FLOOR_DB = -50;

/** An RMS level as a bar height, 0…1 on a decibel scale, so quiet speech still shows. */
export function levelHeight(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * Levels as bars on a fixed grid of time: bar `k` covers
 * [k·sliceMs, (k+1)·sliceMs) since the epoch and holds the loudest reading
 * in it. Anchoring the grid to time rather than to "now" keeps a finished
 * bar's height fixed while it scrolls, so nothing flickers from frame to
 * frame. Returns the newest `count` slices, oldest first, and the start of
 * the newest one.
 */
export function waveformBars(
  samples: readonly LiveContextLevelSample[],
  now: number,
  count: number,
  sliceMs: number,
): { newest: number; bars: Record<LiveContextSource, Float32Array> } {
  const bars = {
    mic: new Float32Array(count),
    system: new Float32Array(count),
  };
  const newestSlice = Math.floor(now / sliceMs);
  for (const sample of samples) {
    const index = count - 1 - (newestSlice - Math.floor(sample.at / sliceMs));
    if (index < 0 || index >= count) continue;
    for (const source of ["mic", "system"] as const) {
      const level = sample.levels[source];
      if (level)
        bars[source][index] = Math.max(
          bars[source][index],
          levelHeight(level.rms),
        );
    }
  }
  return { newest: newestSlice * sliceMs, bars };
}
