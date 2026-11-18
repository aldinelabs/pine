/**
 * Speaker labels for Live Context transcripts: keys, the user's renames and
 * merges, and how a segment's text splits into turns. Pure, so main and the
 * renderer read a transcript the same way.
 */
import {
  LIVE_CONTEXT_SOURCES,
  type LiveContextSegment,
  type LiveContextSource,
  type LiveContextSpeakerKey,
  type LiveContextSpeakers,
  type LiveContextTurn,
} from "./liveContext";

export const LIVE_CONTEXT_SPEAKER_KEY = /^(mic|system)-([1-9]\d{0,3})$/;

/** A user-given speaker name is one short line. */
export const LIVE_CONTEXT_SPEAKER_NAME_MAX = 40;

export function speakerKey(
  source: LiveContextSource,
  speaker: number,
): LiveContextSpeakerKey {
  return `${source}-${speaker}`;
}

export function isSpeakerKey(value: unknown): value is LiveContextSpeakerKey {
  return typeof value === "string" && LIVE_CONTEXT_SPEAKER_KEY.test(value);
}

export function parseSpeakerKey(key: LiveContextSpeakerKey): {
  source: LiveContextSource;
  speaker: number;
} {
  const [, source, speaker] = LIVE_CONTEXT_SPEAKER_KEY.exec(key) ?? [];
  return {
    source: LIVE_CONTEXT_SOURCES.find((each) => each === source) ?? "mic",
    speaker: Number(speaker),
  };
}

export function emptySpeakers(): LiveContextSpeakers {
  return { names: {}, merges: {} };
}

/** The speaker a key ends up as after the user's merges. */
export function resolveSpeaker(
  key: LiveContextSpeakerKey,
  merges: LiveContextSpeakers["merges"],
): LiveContextSpeakerKey {
  const seen = new Set<LiveContextSpeakerKey>();
  let current = key;
  for (;;) {
    const next = merges[current];
    if (!next || seen.has(next)) return current;
    seen.add(current);
    current = next;
  }
}

export function renameSpeaker(
  speakers: LiveContextSpeakers,
  key: LiveContextSpeakerKey,
  name: string,
): LiveContextSpeakers {
  const target = resolveSpeaker(key, speakers.merges);
  const names = { ...speakers.names };
  const trimmed = name.trim().slice(0, LIVE_CONTEXT_SPEAKER_NAME_MAX);
  if (trimmed) names[target] = trimmed;
  else delete names[target];
  return { names, merges: { ...speakers.merges } };
}

/**
 * Folds `from` into `into`. Merging a speaker into itself (or into one
 * already merged into it) changes nothing. An unnamed result keeps the
 * merged speaker's name.
 */
export function mergeSpeakers(
  speakers: LiveContextSpeakers,
  from: LiveContextSpeakerKey,
  into: LiveContextSpeakerKey,
): LiveContextSpeakers {
  const source = resolveSpeaker(from, speakers.merges);
  const target = resolveSpeaker(into, speakers.merges);
  if (source === target) return speakers;
  const names = { ...speakers.names };
  if (!names[target] && names[source]) names[target] = names[source];
  delete names[source];
  return { names, merges: { ...speakers.merges, [source]: target } };
}

/** The segment's text, piece by piece, with who said it. */
export function segmentTurns(
  segment: Pick<LiveContextSegment, "text" | "turns">,
  merges: LiveContextSpeakers["merges"] = {},
): { speaker?: LiveContextSpeakerKey; text: string }[] {
  const turns = (segment.turns ?? [])
    .filter(({ offset }) => offset >= 0 && offset < segment.text.length)
    .sort((a, b) => a.offset - b.offset);
  if (!turns.length) return [{ text: segment.text }];
  const pieces: { speaker?: LiveContextSpeakerKey; text: string }[] = [];
  if (turns[0].offset > 0)
    pieces.push({
      speaker: resolveSpeaker(turns[0].speaker, merges),
      text: segment.text.slice(0, turns[0].offset),
    });
  turns.forEach((turn, index) => {
    const speaker = resolveSpeaker(turn.speaker, merges);
    const text = segment.text.slice(turn.offset, turns[index + 1]?.offset);
    const last = pieces.at(-1);
    if (last && last.speaker === speaker) last.text += text;
    else pieces.push({ speaker, text });
  });
  return pieces.filter(({ text }) => text.trim());
}

/** Speakers in order of first appearance, after merges. */
export function speakersOf(
  segments: readonly Pick<LiveContextSegment, "turns">[],
  merges: LiveContextSpeakers["merges"] = {},
): LiveContextSpeakerKey[] {
  const seen = new Set<LiveContextSpeakerKey>();
  for (const segment of segments)
    for (const turn of segment.turns ?? [])
      seen.add(resolveSpeaker(turn.speaker, merges));
  return [...seen];
}

/** Turns from the helper's numbers to keys; invalid entries are dropped. */
export function parseTurns(
  source: LiveContextSource,
  value: unknown,
): LiveContextTurn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const turns: LiveContextTurn[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { offset, speaker } = entry as Record<string, unknown>;
    if (
      typeof offset !== "number" ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      typeof speaker !== "number" ||
      !Number.isInteger(speaker) ||
      speaker < 1 ||
      speaker > 9999
    )
      continue;
    turns.push({ offset, speaker: speakerKey(source, speaker) });
  }
  return turns.length ? turns.sort((a, b) => a.offset - b.offset) : undefined;
}
