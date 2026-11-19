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

/**
 * Where each speaker resolves to: Pine's own aliases (speakers found to be
 * one voice) first, then the user's merges, which win.
 */
export function speakerMap(
  speakers: LiveContextSpeakers,
): LiveContextSpeakers["merges"] {
  return { ...speakers.aliases, ...speakers.merges };
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
  const target = resolveSpeaker(key, speakerMap(speakers));
  const names = { ...speakers.names };
  const trimmed = name.trim().slice(0, LIVE_CONTEXT_SPEAKER_NAME_MAX);
  if (trimmed) names[target] = trimmed;
  else delete names[target];
  return { ...speakers, names, merges: { ...speakers.merges } };
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
  const map = speakerMap(speakers);
  const source = resolveSpeaker(from, map);
  const target = resolveSpeaker(into, map);
  if (source === target) return speakers;
  const names = { ...speakers.names };
  if (!names[target] && names[source]) names[target] = names[source];
  delete names[source];
  return {
    ...speakers,
    names,
    merges: { ...speakers.merges, [source]: target },
  };
}

/** Pine found `from` to be `into`'s voice; the user's own merges still win. */
export function aliasSpeaker(
  speakers: LiveContextSpeakers,
  from: LiveContextSpeakerKey,
  into: LiveContextSpeakerKey,
): LiveContextSpeakers {
  if (from === into || resolveSpeaker(into, speakerMap(speakers)) === from)
    return speakers;
  const names = { ...speakers.names };
  if (!names[into] && names[from]) names[into] = names[from];
  return { ...speakers, names, aliases: { ...speakers.aliases, [from]: into } };
}

export interface LiveContextTurnPiece {
  /** Undefined while the voice is not known yet. */
  speaker?: LiveContextSpeakerKey;
  provisional?: boolean;
  /** Someone else talks at the same time. */
  overlap?: LiveContextSpeakerKey;
  text: string;
}

/** The segment's text, piece by piece, with who said it. */
export function segmentTurns(
  segment: Pick<LiveContextSegment, "text" | "turns">,
  merges: LiveContextSpeakers["merges"] = {},
): LiveContextTurnPiece[] {
  const turns = (segment.turns ?? [])
    .filter(({ offset }) => offset >= 0 && offset < segment.text.length)
    .sort((a, b) => a.offset - b.offset);
  if (!turns.length) return [{ text: segment.text }];
  const resolve = (key: LiveContextSpeakerKey | undefined) =>
    key && resolveSpeaker(key, merges);
  const pieces: LiveContextTurnPiece[] = [];
  const push = (turn: LiveContextTurn, text: string) => {
    const speaker = resolve(turn.speaker);
    const overlap = resolve(turn.overlap);
    const piece: LiveContextTurnPiece = {
      ...(speaker ? { speaker } : {}),
      ...(turn.provisional ? { provisional: true } : {}),
      ...(overlap && overlap !== speaker ? { overlap } : {}),
      text,
    };
    const last = pieces.at(-1);
    if (
      last &&
      last.speaker === piece.speaker &&
      last.overlap === piece.overlap
    ) {
      last.text += text;
      if (!piece.provisional) delete last.provisional;
    } else pieces.push(piece);
  };
  if (turns[0].offset > 0)
    push(turns[0], segment.text.slice(0, turns[0].offset));
  turns.forEach((turn, index) =>
    push(turn, segment.text.slice(turn.offset, turns[index + 1]?.offset)),
  );
  // A turn starts at a word: the space before it belongs to the turn before.
  for (const [index, piece] of pieces.entries()) {
    const space = /^\s+/.exec(piece.text)?.[0];
    if (!space) continue;
    if (index > 0) pieces[index - 1].text += space;
    piece.text = piece.text.slice(space.length);
  }
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
      for (const key of [turn.speaker, turn.overlap])
        if (key) seen.add(resolveSpeaker(key, merges));
  return [...seen];
}

/** Turns as stored or sent: invalid entries are dropped. */
export function parseTurns(value: unknown): LiveContextTurn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const turns: LiveContextTurn[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { offset, speaker, provisional, overlap } = entry as Record<
      string,
      unknown
    >;
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0)
      continue;
    if (speaker !== undefined && !isSpeakerKey(speaker)) continue;
    turns.push({
      offset,
      ...(speaker !== undefined ? { speaker } : {}),
      ...(provisional === true ? { provisional: true } : {}),
      ...(isSpeakerKey(overlap) ? { overlap } : {}),
    });
  }
  return turns.length ? turns.sort((a, b) => a.offset - b.offset) : undefined;
}
