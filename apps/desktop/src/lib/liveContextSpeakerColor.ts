import type { LiveContextSpeakerKey } from "@/shared/liveContext";
import { parseSpeakerKey } from "@/shared/liveContextSpeakers";

const COLORS = [
  "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "bg-amber-500/14 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  "bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
  "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  "bg-teal-500/12 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
  "bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  "bg-fuchsia-500/12 text-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-300",
] as const;

/**
 * A speaker's pill tint, the same wherever the speaker shows. Mic and
 * system speakers start at different colors, so "1" and "1" differ.
 */
export function speakerColor(key: LiveContextSpeakerKey): string {
  const { source, speaker } = parseSpeakerKey(key);
  return COLORS[(speaker - 1 + (source === "system" ? 4 : 0)) % COLORS.length];
}
