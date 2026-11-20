import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import { errorReason, handleError } from "@/app/errors/errorHandler";
import { useLiveContextTarget } from "@/composables/useLiveContextTarget";
import { speakerColor } from "@/lib/liveContextSpeakerColor";
import type {
  LiveContextSource,
  LiveContextSpeakerKey,
} from "@/shared/liveContext";
import {
  parseSpeakerKey,
  segmentTurns,
  speakerMap,
} from "@/shared/liveContextSpeakers";
import { useLiveContextStore } from "@/stores/liveContext";

export interface LiveContextSpeakerRow {
  speaker: LiveContextSpeakerKey;
  source: LiveContextSource;
  /** Segments the speaker talks in (after merges and aliases). */
  count: number;
  /** The user's name for it, or "" for none. */
  name: string;
  /** What the transcript shows: the name, else "Speaker n". */
  label: string;
  /** "Speaker n". */
  fallback: string;
  color: string;
}

/**
 * The speakers of the conversation's Live Context, in order of first
 * appearance after merges, with how many segments each speaks in, and the
 * rename and merge the speaker chips use.
 */
export function useLiveContextSpeakers(): {
  rows: ComputedRef<LiveContextSpeakerRow[]>;
  rename: (speaker: LiveContextSpeakerKey, name: string) => void;
  merge: (from: LiveContextSpeakerKey, into: LiveContextSpeakerKey) => void;
} {
  const { t } = useI18n();
  const liveContext = useLiveContextStore();
  const target = useLiveContextTarget();

  const rows = computed(() => {
    const session = target.value?.sessionId;
    if (!session) return [];
    const speakers = liveContext.speakersOf(session);
    const merges = speakerMap(speakers);
    const counts = new Map<LiveContextSpeakerKey, number>();
    for (const segment of [
      ...liveContext.segmentsOf(session),
      ...liveContext.volatileOf(session),
    ]) {
      const heard = new Set<LiveContextSpeakerKey>();
      for (const piece of segmentTurns(segment, merges)) {
        if (piece.speaker) heard.add(piece.speaker);
        if (piece.overlap) heard.add(piece.overlap);
      }
      for (const key of heard) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].map(([speaker, count]): LiveContextSpeakerRow => {
      const { source, speaker: number } = parseSpeakerKey(speaker);
      const fallback = t("project.workbench.liveContext.speakers.numbered", {
        n: number,
      });
      const name = speakers.names[speaker];
      return {
        speaker,
        source,
        count,
        name: name ?? "",
        label: name ?? fallback,
        fallback,
        color: speakerColor(speaker),
      };
    });
  });

  function report(error: unknown): void {
    handleError(error, {
      id: "live-context.speakers",
      title: t("project.workbench.liveContext.actionFailed"),
      description: errorReason(error),
    });
  }

  return {
    rows,
    rename: (speaker, name) => {
      const next = target.value;
      if (next)
        void liveContext.renameSpeaker(next, speaker, name).catch(report);
    },
    merge: (from, into) => {
      const next = target.value;
      if (next) void liveContext.mergeSpeakers(next, from, into).catch(report);
    },
  };
}
