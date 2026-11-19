/**
 * Live Context as the agent sees it: the session's transcript cut into
 * speaker lines, either as the increment since the last notice or as a page
 * the `read_live_transcript` tool asked for. Pure, so main slices the
 * transcript where it lives and the agent only formats the result. See
 * docs/live-context.md §7.
 */
import type {
  LiveContextSegment,
  LiveContextSource,
  LiveContextSpeakerKey,
  LiveContextSpeakers,
  LiveContextState,
  LiveContextTranscript,
} from "./liveContext";
import {
  parseSpeakerKey,
  resolveSpeaker,
  segmentTurns,
  speakerMap,
} from "./liveContextSpeakers";

export const READ_LIVE_TRANSCRIPT_TOOL_NAME = "read_live_transcript" as const;

/**
 * New transcript a notice attaches in full, about five minutes of steady
 * speech. Above it the notice points to the tool instead.
 */
export const LIVE_CONTEXT_INLINE_MAX_TOKENS = 1500;
/** The latest lines a pointer notice still attaches verbatim. */
export const LIVE_CONTEXT_TAIL_MAX_TOKENS = 300;
/** One `read_live_transcript` page at most. */
export const LIVE_CONTEXT_READ_MAX_TOKENS = 6000;
export const LIVE_CONTEXT_READ_MAX_LINES = 300;
/** Consecutive words by one speaker stay one line across this much quiet. */
const MERGE_GAP_MS = 2 * 60 * 1000;

/** The capture as the tool reports it; "stopped" covers every idle state. */
export type LiveContextCaptureState =
  "starting" | "listening" | "paused" | "stopped";

/** One speaker's consecutive words, possibly over several segments. */
export interface LiveContextAgentLine {
  /** The last segment the line includes, for paging. */
  segmentId: string;
  /** Unix ms the line starts and ends. */
  at: number;
  end: number;
  /** As the card shows it: the user's name or "Speaker N", or Me/Others. */
  speaker: string;
  text: string;
  /** Mic text that is mostly the loudspeaker, kept when there is no system source. */
  echo?: true;
}

export type LiveContextHostOperation =
  | {
      op: "increment";
      /** The last segment the model has; omitted for the first notice. */
      after?: string;
    }
  | {
      op: "read";
      /** Local time of day, "HH:MM" or "HH:MM:SS", inclusive. */
      from?: string;
      to?: string;
      /** Only the last N minutes (before now while capturing). */
      lastMinutes?: number;
      /** Case-insensitive part of a speaker label. */
      speaker?: string;
      /** Case-insensitive text to look for. */
      query?: string;
      /** Continue after this segment (a previous page's `nextCursor`). */
      cursor?: string;
    };

/** New content too long to attach: what it holds and where it is. */
export interface LiveContextSkipped {
  from: number;
  to: number;
  lines: number;
  tokens: number;
  /** Turns per speaker, most first, then by label. */
  speakers: { speaker: string; turns: number }[];
}

export interface LiveContextIncrement {
  sources: LiveContextSource[];
  /** Lines after `after`: all of them, or only the latest when `skipped`. */
  lines: LiveContextAgentLine[];
  /** Set when the new content is over the inline budget. */
  skipped?: LiveContextSkipped;
  /** The last final segment, for the next increment. */
  cursor: string;
  /** `after` is gone: the transcript was deleted and started again. */
  cursorMissing: boolean;
  /** Every speaker key heard, resolved to its current label. */
  labels: Record<string, string>;
}

export interface LiveContextReadHeader {
  state: LiveContextCaptureState;
  sources: LiveContextSource[];
  /** Unix ms of the first and last final segment. */
  firstAt: number;
  lastAt: number;
}

export interface LiveContextRead {
  header: LiveContextReadHeader;
  lines: LiveContextAgentLine[];
  /** Pass as `cursor` with the same filters for the next page. */
  nextCursor?: string;
}

export type LiveContextHostResult =
  | { op: "increment"; increment: LiveContextIncrement | null }
  | { op: "read"; read: LiveContextRead | null };

/** What main knows about one session's Live Context. */
export interface LiveContextAgentSource {
  transcript: LiveContextTranscript;
  /** Set while this session is the one capturing. */
  capture?: { state: LiveContextState; sources: LiveContextSource[] };
  now: number;
}

const SOURCE_NAME: Record<LiveContextSource, string> = {
  mic: "microphone",
  system: "system audio",
};

const WIDE = /[぀-ヿ㐀-鿿가-힯豈-﫿]/u;

/** Close enough for a budget: CJK about a token each, other text ~4 chars. */
export function estimateTokens(text: string): number {
  let wide = 0;
  for (const char of text) if (WIDE.test(char)) wide += 1;
  return wide + Math.ceil((text.length - wide) / 4);
}

/** 24-hour local time, "HH:MM:SS". */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function speakerLabel(
  key: LiveContextSpeakerKey,
  speakers: LiveContextSpeakers,
  merges: LiveContextSpeakers["merges"],
): string {
  const resolved = resolveSpeaker(key, merges);
  const { source, speaker } = parseSpeakerKey(resolved);
  const name = speakers.names[resolved] ?? `Speaker ${speaker}`;
  return `${name} (${SOURCE_NAME[source]})`;
}

/** A segment as lines, one per speaker turn, labeled as the card labels it. */
export function segmentLines(
  segment: LiveContextSegment,
  speakers: LiveContextSpeakers,
): LiveContextAgentLine[] {
  const base = {
    segmentId: segment.id,
    at: segment.start,
    end: segment.end,
    ...(segment.echo ? { echo: true as const } : {}),
  };
  if (!segment.turns?.length) {
    const text = segment.text.trim();
    if (!text) return [];
    return [
      {
        ...base,
        speaker:
          segment.source === "mic"
            ? "Me (microphone)"
            : "Others (system audio)",
        text,
      },
    ];
  }
  const merges = speakerMap(speakers);
  return segmentTurns(segment, merges).map((piece) => {
    const label = piece.speaker
      ? speakerLabel(piece.speaker, speakers, merges)
      : `Unknown speaker (${SOURCE_NAME[segment.source]})`;
    return {
      ...base,
      speaker: piece.overlap
        ? `${label} + ${speakerLabel(piece.overlap, speakers, merges)}`
        : label,
      text: piece.text.trim(),
    };
  });
}

function joinText(before: string, after: string): string {
  const last = before.at(-1) ?? "";
  const first = after[0] ?? "";
  return WIDE.test(last) || WIDE.test(first)
    ? `${before}${after}`
    : `${before} ${after}`;
}

/** One speaker's consecutive lines joined, across short pauses. */
function mergeLines(
  lines: readonly LiveContextAgentLine[],
): LiveContextAgentLine[] {
  const merged: LiveContextAgentLine[] = [];
  for (const line of lines) {
    const last = merged.at(-1);
    if (
      last &&
      last.speaker === line.speaker &&
      last.echo === line.echo &&
      line.at - last.end <= MERGE_GAP_MS
    ) {
      last.text = joinText(last.text, line.text);
      last.end = Math.max(last.end, line.end);
      last.segmentId = line.segmentId;
    } else merged.push({ ...line });
  }
  return merged;
}

/**
 * Segments as speaker lines: echoes dropped when the system audio they
 * repeat is in the transcript too, and one speaker's consecutive words
 * joined into one line.
 */
export function transcriptLines(
  segments: readonly LiveContextSegment[],
  speakers: LiveContextSpeakers,
  hasSystem: boolean,
): LiveContextAgentLine[] {
  return mergeLines(
    segments
      .filter((segment) => !(segment.echo && hasSystem))
      .flatMap((segment) => segmentLines(segment, speakers)),
  );
}

export function lineTokens(line: LiveContextAgentLine): number {
  // The time and label around the text cost about this much.
  return estimateTokens(line.speaker) + estimateTokens(line.text) + 6;
}

function finalSegments(source: LiveContextAgentSource): LiveContextSegment[] {
  return source.transcript.segments.filter((segment) => segment.text.trim());
}

function sourcesOf(
  segments: readonly LiveContextSegment[],
): LiveContextSource[] {
  return (["mic", "system"] as const).filter((each) =>
    segments.some((segment) => segment.source === each),
  );
}

function captureState(
  capture: LiveContextAgentSource["capture"],
): LiveContextCaptureState {
  switch (capture?.state) {
    case "preparing":
    case "downloading":
      return "starting";
    case "listening":
      return "listening";
    case "paused":
      return "paused";
    default:
      return "stopped";
  }
}

/** Every speaker key heard, resolved through aliases, merges and names. */
function speakerLabels(
  segments: readonly LiveContextSegment[],
  speakers: LiveContextSpeakers,
): Record<string, string> {
  const merges = speakerMap(speakers);
  const labels: Record<string, string> = {};
  for (const segment of segments)
    for (const turn of segment.turns ?? [])
      for (const key of [turn.speaker, turn.overlap])
        if (key && !(key in labels))
          labels[key] = speakerLabel(key, speakers, merges);
  return Object.fromEntries(
    Object.entries(labels).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
}

function skippedSummary(
  lines: readonly LiveContextAgentLine[],
): LiveContextSkipped {
  const turns = new Map<string, number>();
  for (const line of lines)
    turns.set(line.speaker, (turns.get(line.speaker) ?? 0) + 1);
  return {
    from: lines[0].at,
    to: lines.at(-1)?.end ?? lines[0].end,
    lines: lines.length,
    tokens: lines.reduce((sum, line) => sum + lineTokens(line), 0),
    speakers: [...turns]
      .map(([speaker, count]) => ({ speaker, turns: count }))
      .sort(
        (a, b) =>
          b.turns - a.turns ||
          (a.speaker < b.speaker ? -1 : a.speaker > b.speaker ? 1 : 0),
      ),
  };
}

/** The last line cut to its final `maxTokens`, at a word where it can be. */
function tailOf(
  line: LiveContextAgentLine,
  maxTokens: number,
): LiveContextAgentLine {
  // The label, time and ellipsis count against the budget too.
  const room = maxTokens - lineTokens({ ...line, text: "" }) - 1;
  let text = line.text;
  while (text.length > 1 && estimateTokens(text) > room)
    text = text.slice(Math.ceil(text.length / 8));
  const space = text.indexOf(" ");
  if (text !== line.text && space > 0 && space < 20)
    text = text.slice(space + 1);
  return text === line.text ? line : { ...line, text: `…${text}` };
}

/**
 * The final segments after `after`: all of them when they fit the inline
 * budget, otherwise only the latest lines plus a summary of the rest. The
 * cursor moves to the end either way. Null when the session has no
 * transcript.
 */
export function liveContextIncrement(
  source: LiveContextAgentSource,
  operation: Extract<LiveContextHostOperation, { op: "increment" }>,
): LiveContextIncrement | null {
  const segments = finalSegments(source);
  const cursor = segments.at(-1)?.id;
  if (!cursor) return null;
  const { speakers } = source.transcript;
  const index =
    operation.after === undefined
      ? -1
      : segments.findIndex((segment) => segment.id === operation.after);
  const cursorMissing = operation.after !== undefined && index < 0;
  const sources = sourcesOf(segments);
  const lines = transcriptLines(
    segments.slice(index + 1),
    speakers,
    sources.includes("system"),
  );
  const base = {
    sources,
    cursor,
    cursorMissing,
    labels: speakerLabels(segments, speakers),
  };
  const total = lines.reduce((sum, line) => sum + lineTokens(line), 0);
  if (total <= LIVE_CONTEXT_INLINE_MAX_TOKENS) return { ...base, lines };
  const tail: LiveContextAgentLine[] = [];
  let room = LIVE_CONTEXT_TAIL_MAX_TOKENS;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const cost = lineTokens(lines[at]);
    if (cost > room) {
      // The latest exchange is always visible, if only its end.
      if (tail.length === 0) tail.unshift(tailOf(lines[at], room));
      break;
    }
    tail.unshift(lines[at]);
    room -= cost;
  }
  const rest = lines.slice(0, lines.length - tail.length);
  // A cut line's start is skipped too.
  if (tail[0] !== lines[lines.length - tail.length])
    rest.push(lines[lines.length - tail.length]);
  return {
    ...base,
    lines: tail,
    ...(rest.length ? { skipped: skippedSummary(rest) } : {}),
  };
}

/** Seconds into the local day of "HH:MM" or "HH:MM:SS". */
export function parseClockTime(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const [hours, minutes, seconds] = [match[1], match[2], match[3] ?? "0"].map(
    Number,
  );
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

function secondOfDay(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

/**
 * One page of the transcript, oldest first, filtered by time, speaker and
 * text and bounded in lines and tokens. Pages end at segment boundaries;
 * `nextCursor` continues after the last one. Null without a transcript.
 */
export function readLiveContext(
  source: LiveContextAgentSource,
  operation: Extract<LiveContextHostOperation, { op: "read" }>,
): LiveContextRead | null {
  const segments = finalSegments(source);
  if (segments.length === 0) return null;
  const from =
    operation.from === undefined ? undefined : parseClockTime(operation.from);
  const to =
    operation.to === undefined ? undefined : parseClockTime(operation.to);
  if (operation.from !== undefined && from === undefined)
    throw new Error(`"from" must be a local time like 14:05 or 14:05:30.`);
  if (operation.to !== undefined && to === undefined)
    throw new Error(`"to" must be a local time like 14:05 or 14:05:30.`);
  const start =
    operation.cursor === undefined
      ? 0
      : segments.findIndex((segment) => segment.id === operation.cursor) + 1;
  if (operation.cursor !== undefined && start === 0)
    throw new Error(
      "That cursor is not in this transcript; read again without it.",
    );
  const state = captureState(source.capture);
  const end =
    state === "stopped" ? (segments.at(-1)?.end ?? source.now) : source.now;
  const since =
    operation.lastMinutes === undefined
      ? undefined
      : end - operation.lastMinutes * 60_000;
  const speaker = operation.speaker?.trim().toLowerCase();
  const query = operation.query?.trim().toLowerCase();
  const sources = sourcesOf(segments);
  const hasSystem = sources.includes("system");
  const page: LiveContextAgentLine[] = [];
  let budget = LIVE_CONTEXT_READ_MAX_TOKENS;
  let lastId: string | undefined;
  let nextCursor: string | undefined;
  for (const segment of segments.slice(start)) {
    if (since !== undefined && segment.end < since) continue;
    const second = secondOfDay(segment.start);
    if (from !== undefined && second < from) continue;
    if (to !== undefined && second > to) continue;
    if (segment.echo && hasSystem) continue;
    const lines = segmentLines(segment, source.transcript.speakers).filter(
      (line) =>
        (!speaker || line.speaker.toLowerCase().includes(speaker)) &&
        (!query || line.text.toLowerCase().includes(query)),
    );
    if (lines.length === 0) continue;
    const cost = lines.reduce((sum, line) => sum + lineTokens(line), 0);
    // Pages end between segments; the first segment always fits.
    if (
      lastId !== undefined &&
      (cost > budget ||
        page.length + lines.length > LIVE_CONTEXT_READ_MAX_LINES)
    ) {
      nextCursor = lastId;
      break;
    }
    page.push(...lines);
    budget -= cost;
    lastId = segment.id;
  }
  return {
    header: {
      state,
      sources:
        state !== "stopped" && source.capture
          ? [...source.capture.sources]
          : sources,
      firstAt: segments[0].start,
      lastAt: segments.at(-1)?.end ?? segments[0].end,
    },
    lines: mergeLines(page),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function answerLiveContextOperation(
  source: LiveContextAgentSource,
  operation: LiveContextHostOperation,
): LiveContextHostResult {
  return operation.op === "increment"
    ? { op: "increment", increment: liveContextIncrement(source, operation) }
    : { op: "read", read: readLiveContext(source, operation) };
}
