// bun replay.ts <helper.jsonl> <out.json> [options JSON]
//
// Replays a helper run through Pine's own speaker code (SpeakerSession, as
// LiveContextService drives it) and records what the transcript showed:
// each final segment's labels when it became final ("first"), at the end of
// the capture ("live") and after the final pass ("final"), and how often a
// segment's labels changed after it was first labeled. score.py scores it.
import { readFileSync, writeFileSync } from "node:fs";

import type { LiveContextTurn } from "../../../../src/shared/liveContext";
import type { SpeakerSession as Session } from "../../../../src/main/liveContextDiarizer";

// PINE_DIARIZER=<path to another liveContextDiarizer.ts> compares versions.
const { SpeakerSession } = (await import(
  process.env.PINE_DIARIZER ?? "../../../../src/main/liveContextDiarizer"
)) as { SpeakerSession: typeof Session };

const [input, output, optionsJson] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: bun replay.ts <helper.jsonl> <out.json> [options]");
  process.exit(2);
}
const options = optionsJson ? JSON.parse(optionsJson) : {};
const events = readFileSync(input, "utf8")
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as Record<string, unknown>);

const session = new SpeakerSession(options);
session.beginCapture();

interface Seen {
  id: string;
  source: string;
  text: string;
  words: [number, number, number][];
  final: boolean;
  /** Audio time when the segment became final. */
  finalAt?: number;
  turns?: LiveContextTurn[];
  first?: LiveContextTurn[];
  /** Audio time when it was first labeled (after it was final). */
  labeledAt?: number;
  changes: number;
}
const segments = new Map<string, Seen>();
let audioTime = 0;
let busyMs = 0;
const aliases: [string, string][] = [];

function apply(labels: { id: string; turns: LiveContextTurn[] }[]) {
  for (const label of labels) {
    const segment = segments.get(label.id);
    if (!segment) continue;
    const before = JSON.stringify(segment.turns ?? null);
    segment.turns = label.turns;
    if (!segment.final) continue;
    if (segment.first === undefined) {
      segment.first = label.turns;
      segment.labeledAt = audioTime;
    } else if (before !== JSON.stringify(label.turns)) segment.changes += 1;
  }
}

for (const event of events) {
  const type = event.type;
  if (type === "window" && typeof event.t1 === "number")
    audioTime = Math.max(audioTime, event.t1);
  if (
    !["window", "embedding", "echo", "device", "segment"].includes(String(type))
  )
    continue;
  let segmentId: string | undefined;
  if (type === "segment") {
    if (typeof event.id !== "string" || typeof event.a0 !== "number") continue;
    segmentId = `c-${event.id}`;
    const existing = segments.get(segmentId);
    const seen: Seen = existing ?? {
      id: segmentId,
      source: String(event.source),
      text: "",
      words: [],
      final: false,
      changes: 0,
    };
    seen.text = String(event.text ?? "");
    seen.words = (event.words as [number, number, number][]) ?? [];
    segments.set(segmentId, seen);
  }
  const started = performance.now();
  const result = session.handle(event, segmentId);
  busyMs += performance.now() - started;
  // As LiveContextService: the segment's labels are worked out before the
  // segment is shown, so a final segment appears with them.
  const segment = segmentId ? segments.get(segmentId) : undefined;
  if (segment && event.final === true && !segment.final) {
    for (const label of result.labels)
      if (label.id === segmentId) segment.turns = label.turns;
    segment.final = true;
    segment.finalAt = audioTime;
    if (segment.turns) {
      segment.first = segment.turns;
      segment.labeledAt = audioTime;
    }
  }
  apply(result.labels);
  aliases.push(...result.aliases);
}

const finals = [...segments.values()].filter((each) => each.final && each.text);
const live = new Map(finals.map((each) => [each.id, each.turns]));
// The timeline (for DER): who speaks at each 10 ms of helper-voiced audio.
const sources = new Set(finals.map((each) => each.source));
const source = (sources.size ? [...sources][0] : "mic") as "mic" | "system";
const diarizer = session.diarizer(source);
const voiced: [number, number][] = [];
for (const event of events)
  if (event.type === "window" && event.source === source)
    for (const [a, b] of event.turns as [number, number, number][])
      voiced.push([a, b]);
function timeline(): [number, number, string][] {
  const end = Math.max(0, ...voiced.map(([, b]) => b));
  const step = 0.01;
  const marks = new Uint8Array(Math.ceil(end / step) + 1);
  for (const [a, b] of voiced)
    for (let i = Math.floor(a / step); i < Math.ceil(b / step); i += 1)
      marks[i] = 1;
  const result: [number, number, string][] = [];
  for (let i = 0; i < marks.length; i += 1) {
    if (!marks[i]) continue;
    const who = diarizer.speakerAtTime((i + 0.5) * step)?.speaker;
    if (who === undefined) continue;
    const last = result.at(-1);
    const t = i * step;
    if (last && last[2] === String(who) && Math.abs(last[1] - t) < 1e-6)
      last[1] = t + step;
    else result.push([t, t + step, String(who)]);
  }
  return result;
}
const timelineLive = timeline();
const started = performance.now();
const { labels } = session.finish({ names: {}, merges: {} });
const finishMs = performance.now() - started;
for (const label of labels) {
  const segment = segments.get(label.id);
  if (segment) segment.turns = label.turns;
}

writeFileSync(
  output,
  JSON.stringify({
    options,
    aliases,
    timelineLive,
    timeline: timeline(),
    busyMs: Math.round(busyMs),
    finishMs: Math.round(finishMs),
    stats: diarizer.stats,
    segments: finals.map((each) => ({
      id: each.id,
      text: each.text,
      words: each.words,
      finalAt: each.finalAt,
      labeledAt: each.labeledAt,
      changes: each.changes,
      first: each.first ?? null,
      live: live.get(each.id) ?? null,
      final: each.turns ?? null,
    })),
  }),
);
