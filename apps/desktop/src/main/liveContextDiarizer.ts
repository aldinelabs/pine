/**
 * Speaker clustering for Live Context, in the main process. The helper
 * sends what it measured (analysis windows with local speakers, voice
 * embeddings, echo); everything that decides who is who lives here, as pure
 * and deterministic logic, so a session can be replayed from its stored
 * embeddings and tested without audio. See docs/live-context.md §3.4.
 *
 * Times are seconds on one clock per source: each capture's analyzer time
 * plus an offset that keeps captures of a session apart.
 */
import type { LiveContextSource, LiveContextTurn } from "../shared/liveContext";
import { speakerKey } from "../shared/liveContextSpeakers";

export interface DiarizerOptions {
  /** A voice this similar to a speaker joins it. */
  tauHigh: number;
  /** Below this it is not that speaker; in between is ambiguous. */
  tauLow: number;
  maxSpeakers: number;
  /** "About N people": caps speakers at N + 1 and merges more eagerly. */
  expectedSpeakers?: number;
  /** A new speaker needs this many similar embeddings… */
  confirmCount: number;
  /** …covering this much speech. */
  confirmSeconds: number;
  reservoirSize: number;
  /** Labels change live only this far back; older ones only by alias or the final pass. */
  liveSeconds: number;
  consolidateSeconds: number;
  /** Shorter turns join a neighbor. */
  minTurnSeconds: number;
}

export const DEFAULT_DIARIZER_OPTIONS: DiarizerOptions = {
  tauHigh: 0.6,
  tauLow: 0.4,
  maxSpeakers: 12,
  confirmCount: 2,
  confirmSeconds: 3,
  reservoirSize: 20,
  liveSeconds: 60,
  consolidateSeconds: 90,
  minTurnSeconds: 0.5,
};

/** An analysis window: who spoke when, as local speaker numbers. */
export interface DiarizerWindowInput {
  id: number;
  t0: number;
  t1: number;
  /** Segmentation ran (slow path); else one speaker throughout (fast path). */
  slow: boolean;
  /** A fast-path window continues this window's last voice. */
  after?: number;
  turns: readonly (readonly [start: number, end: number, local: number])[];
}

export interface DiarizerEmbeddingInput {
  window: number;
  local: number;
  t0: number;
  t1: number;
  /** Seconds of clean speech behind it. */
  seconds: number;
  /** 0–1: duration, signal to noise and overlap, used as a weight. */
  quality: number;
  vector: Float32Array;
}

export interface DiarizerSegmentInput {
  id: string;
  t0: number;
  t1: number;
  /** Where each timed run of the text starts (UTF-16) and when it was said. */
  words: readonly (readonly [offset: number, start: number, end: number])[];
}

export interface DiarizerLabel {
  id: string;
  turns: LiveContextTurn[];
  /** Mostly the loudspeaker heard through the mic. */
  echo?: boolean;
}

/** User edits within this source, as hard constraints for the final pass. */
export interface DiarizerUserConstraints {
  /** Speaker → the speaker the user merged it into (resolved). */
  merges: ReadonlyMap<number, number>;
  /** Speakers the user named. */
  named: ReadonlySet<number>;
}

interface Window {
  id: number;
  t0: number;
  t1: number;
  slow: boolean;
  units: Unit[];
}

interface Unit {
  window: Window;
  local: number;
  spans: [number, number][];
  t0: number;
  t1: number;
  /** Must-links: the same local speaker in overlapping windows. */
  links: Unit[];
  embedding?: Embedding;
}

type EmbeddingState = "accepted" | "ambiguous" | "candidate";

interface Embedding {
  seq: number;
  unit: Unit;
  t0: number;
  t1: number;
  seconds: number;
  quality: number;
  vector: Float32Array;
  speaker?: number;
  state: EmbeddingState;
  /** Score against `speaker` when decided. */
  score: number;
}

interface Speaker {
  id: number;
  centroid: Float32Array;
  weight: number;
  reservoir: Float32Array[];
  seconds: number;
}

interface Segment extends DiarizerSegmentInput {
  emitted?: string;
}

interface UnitLabel {
  speaker?: number;
  provisional: boolean;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

export function normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  return vector;
}

/** Binary search: the first index whose value is ≥ `target`. */
function lowerBound<T>(
  items: readonly T[],
  target: number,
  value: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value(items[middle]) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Seconds covered by the union of the spans. */
function coverage(spans: [number, number][]): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of sorted) {
    if (stop <= end) continue;
    total += stop - Math.max(start, end);
    end = stop;
  }
  return total;
}

/** Running mean and spread of intra-speaker scores, for adaptive thresholds. */
class Calibration {
  count = 0;
  mean = 0;
  variance = 0;
  add(value: number): void {
    this.count += 1;
    const rate = Math.max(0.03, 1 / this.count);
    const delta = value - this.mean;
    this.mean += rate * delta;
    this.variance = (1 - rate) * (this.variance + rate * delta * delta);
  }
}

/**
 * One source's speakers. Feed it the helper's events in order; `drain`
 * returns segments whose labels changed, `finish` runs the final pass.
 */
export class SourceDiarizer {
  readonly options: DiarizerOptions;
  private readonly windows: { fast: Window[]; slow: Window[] } = {
    fast: [],
    slow: [],
  };
  private readonly windowById = new Map<number, Window>();
  /** Windows that may still overlap the next one (stitching). */
  private recent: Window[] = [];
  private readonly embeddings: Embedding[] = [];
  /** The same, by start time, to find what covers a moment. */
  private readonly byStart: Embedding[] = [];
  private readonly speakers = new Map<number, Speaker>();
  private readonly alias = new Map<number, number>();
  private readonly pendingAliases: [number, number][] = [];
  /** How often two speakers spoke in one window (so are two people). */
  private readonly apart = new Map<string, number>();
  private candidates: Embedding[] = [];
  private readonly calibration = new Calibration();
  private readonly segments = new Map<string, Segment>();
  private readonly segmentOrder: Segment[] = [];
  private readonly echoes: [number, number][] = [];
  private nextSpeaker = 1;
  private latest = 0;
  private lastConsolidation = 0;
  private relaxUntil = -Infinity;
  /** Window ids are per capture; this keeps them apart. */
  private windowBase = 0;
  private maxWindowId = 0;
  private finalized = false;
  /** Counters for the performance report. */
  readonly stats = {
    windows: 0,
    slowWindows: 0,
    embeddings: 0,
    consolidations: 0,
  };

  constructor(
    readonly source: LiveContextSource,
    options: Partial<DiarizerOptions> = {},
  ) {
    this.options = { ...DEFAULT_DIARIZER_OPTIONS, ...options };
    if (this.options.expectedSpeakers)
      this.options.maxSpeakers = Math.min(
        this.options.maxSpeakers,
        this.options.expectedSpeakers + 1,
      );
  }

  // MARK: Input

  /** A new capture of the session: window ids restart, time goes on. */
  beginCapture(): void {
    this.windowBase = this.maxWindowId + 1;
    this.recent = [];
  }

  /** The audio device changed: the same voices sound different for a while. */
  deviceChanged(): void {
    this.recent = [];
    this.relaxUntil = this.latest + 30;
  }

  echo(t0: number, t1: number): void {
    if (t1 > t0) this.echoes.push([t0, t1]);
  }

  window(input: DiarizerWindowInput): void {
    const id = this.windowBase + input.id;
    this.maxWindowId = Math.max(this.maxWindowId, id);
    const window: Window = {
      id,
      t0: input.t0,
      t1: input.t1,
      slow: input.slow,
      units: [],
    };
    const byLocal = new Map<number, Unit>();
    for (const [start, end, local] of input.turns) {
      if (!(end > start)) continue;
      let unit = byLocal.get(local);
      if (!unit) {
        unit = { window, local, spans: [], t0: start, t1: end, links: [] };
        byLocal.set(local, unit);
        window.units.push(unit);
      }
      unit.spans.push([start, end]);
      unit.t0 = Math.min(unit.t0, start);
      unit.t1 = Math.max(unit.t1, end);
    }
    if (input.slow) this.stitch(window);
    else if (input.after !== undefined)
      this.continueFrom(window, this.windowBase + input.after);
    (input.slow ? this.windows.slow : this.windows.fast).push(window);
    this.windowById.set(id, window);
    this.recent = [
      ...this.recent.filter((each) => each.t1 > window.t0),
      window,
    ];
    this.latest = Math.max(this.latest, input.t1);
    this.stats.windows += 1;
    if (input.slow) this.stats.slowWindows += 1;
  }

  embedding(input: DiarizerEmbeddingInput): void {
    const unit = this.windowById
      .get(this.windowBase + input.window)
      ?.units.find((each) => each.local === input.local);
    if (!unit) return;
    const embedding: Embedding = {
      seq: this.embeddings.length,
      unit,
      t0: input.t0,
      t1: input.t1,
      seconds: input.seconds,
      quality: Math.min(1, Math.max(0.05, input.quality)),
      vector: normalize(Float32Array.from(input.vector)),
      state: "candidate",
      score: 0,
    };
    this.embeddings.push(embedding);
    let at = this.byStart.length;
    while (at > 0 && this.byStart[at - 1].t0 > embedding.t0) at -= 1;
    this.byStart.splice(at, 0, embedding);
    unit.embedding = embedding;
    this.stats.embeddings += 1;
    this.decide(embedding);
    if (this.latest - this.lastConsolidation >= this.options.consolidateSeconds)
      this.consolidate();
  }

  segment(input: DiarizerSegmentInput): void {
    const existing = this.segments.get(input.id);
    if (existing) {
      Object.assign(existing, input);
      return;
    }
    const segment: Segment = { ...input };
    this.segments.set(input.id, segment);
    this.segmentOrder.push(segment);
  }

  /** What the transcript already says, so only real changes are written. */
  setEmitted(id: string, label: Omit<DiarizerLabel, "id">): void {
    const segment = this.segments.get(id);
    if (segment) segment.emitted = JSON.stringify(label);
  }

  // MARK: Output

  /** Speaker merges found since the last call: [from, into]. */
  takeAliases(): [number, number][] {
    return this.pendingAliases.splice(0);
  }

  /** Segments of the last `liveSeconds` whose labels changed. */
  drain(): DiarizerLabel[] {
    const from = this.finalized
      ? -Infinity
      : this.latest - this.options.liveSeconds;
    const labels: DiarizerLabel[] = [];
    for (let index = this.segmentOrder.length - 1; index >= 0; index -= 1) {
      const segment = this.segmentOrder[index];
      if (segment.t1 < from) break;
      const label = this.label(segment);
      if (label) labels.unshift(label);
    }
    return labels;
  }

  /** The speaker an id stands for after automatic merges. */
  resolve(id: number): number {
    let current = id;
    for (let guard = 0; guard < 64; guard += 1) {
      const next = this.alias.get(current);
      if (next === undefined) return current;
      current = next;
    }
    return current;
  }

  /** Who spoke at `time` (for evaluation): the resolved speaker, if known. */
  speakerAtTime(
    time: number,
  ): { speaker?: number; overlap?: number } | undefined {
    const found = this.speakerAt(time - 0.005, time + 0.005);
    if (!found) return undefined;
    return {
      ...(found.label.speaker !== undefined
        ? { speaker: this.resolve(found.label.speaker) }
        : {}),
      ...(found.overlap !== undefined
        ? { overlap: this.resolve(found.overlap) }
        : {}),
    };
  }

  get speakerCount(): number {
    return this.speakers.size;
  }

  /** Each stored embedding's speaker, for persisting the final pass. */
  assignments(): [seq: number, speaker: number][] {
    return this.embeddings
      .filter((each) => each.speaker !== undefined && each.state === "accepted")
      .map((each) => [each.seq, this.resolve(each.speaker!)]);
  }

  // MARK: Online clustering

  private thresholds(): { high: number; low: number } {
    const { tauHigh, tauLow } = this.options;
    let high = tauHigh;
    if (this.calibration.count >= 20) {
      const spread = Math.sqrt(this.calibration.variance);
      high = Math.min(
        tauHigh + 0.1,
        Math.max(tauHigh - 0.05, this.calibration.mean - 2 * spread),
      );
    }
    const low = high - (tauHigh - tauLow);
    if (this.latest < this.relaxUntil)
      return { high: low + 0.05, low: low - 0.05 };
    return { high, low };
  }

  score(vector: Float32Array, speaker: Speaker): number {
    const centroid = dot(vector, speaker.centroid);
    const top = speaker.reservoir
      .map((each) => dot(vector, each))
      .sort((a, b) => b - a);
    const count = Math.min(3, top.length);
    let mean = 0;
    for (let i = 0; i < count; i += 1) mean += top[i] / count;
    return Math.max(centroid, mean);
  }

  private decide(embedding: Embedding): void {
    const { high, low } = this.thresholds();
    const forbidden = this.forbidden(embedding.unit);
    // Must-link: the same local speaker in an overlapping window is the
    // same person, unless the voice clearly disagrees.
    const prior = this.inherited(embedding.unit, true);
    if (prior !== undefined && !forbidden.has(prior)) {
      const speaker = this.speakers.get(prior);
      if (speaker) {
        const score = this.score(embedding.vector, speaker);
        // Same-voice scores tune the thresholds; a broken link is no sample.
        if (score >= low) this.calibration.add(score);
        // Segmentation sometimes gives two similar voices one number, so
        // the link needs the voice to roughly agree.
        if (score >= (high + low) / 2) {
          this.accept(embedding, speaker, score, score >= high);
          return;
        }
      }
    }
    let best: Speaker | undefined;
    let bestScore = -1;
    for (const speaker of this.speakers.values()) {
      if (forbidden.has(speaker.id)) continue;
      const score = this.score(embedding.vector, speaker);
      if (score > bestScore) {
        best = speaker;
        bestScore = score;
      }
    }
    if (best && bestScore >= high) {
      this.accept(embedding, best, bestScore, true);
      return;
    }
    if (best && bestScore >= low) {
      embedding.state = "ambiguous";
      embedding.speaker = best.id;
      embedding.score = bestScore;
    }
    this.candidates.push(embedding);
    this.confirm(embedding);
    if (
      embedding.state !== "accepted" &&
      this.speakers.size >= this.options.maxSpeakers &&
      best
    ) {
      // Full: the closest speaker, provisionally.
      embedding.state = "ambiguous";
      embedding.speaker = best.id;
      embedding.score = bestScore;
    }
  }

  private accept(
    embedding: Embedding,
    speaker: Speaker,
    score: number,
    learn: boolean,
  ): void {
    embedding.state = "accepted";
    embedding.speaker = speaker.id;
    embedding.score = score;
    if (learn) this.learn(speaker, embedding);
    for (const other of embedding.unit.window.units) {
      if (other === embedding.unit || other.embedding?.state !== "accepted")
        continue;
      const id = this.resolve(other.embedding.speaker!);
      if (id !== speaker.id) this.noteApart(id, speaker.id);
    }
  }

  private learn(speaker: Speaker, embedding: Embedding): void {
    const weight = embedding.quality;
    speaker.weight += weight;
    // A running mean at first, then a slow moving average for drift.
    const rate = Math.max(weight / speaker.weight, 0.02 * weight);
    for (let i = 0; i < speaker.centroid.length; i += 1)
      speaker.centroid[i] =
        (1 - rate) * speaker.centroid[i] + rate * embedding.vector[i];
    normalize(speaker.centroid);
    speaker.seconds += embedding.seconds;
    this.addExemplar(speaker, embedding.vector);
  }

  /** Keeps the reservoir diverse: a new voice sample replaces the most redundant one. */
  private addExemplar(speaker: Speaker, vector: Float32Array): void {
    const reservoir = speaker.reservoir;
    if (reservoir.length < this.options.reservoirSize) {
      reservoir.push(vector);
      return;
    }
    const closest = (index: number, candidate: Float32Array) => {
      let max = -1;
      for (let j = 0; j < reservoir.length; j += 1)
        if (j !== index) max = Math.max(max, dot(candidate, reservoir[j]));
      return max;
    };
    let redundant = 0;
    let redundancy = -1;
    for (let i = 0; i < reservoir.length; i += 1) {
      const value = closest(i, reservoir[i]);
      if (value > redundancy) {
        redundancy = value;
        redundant = i;
      }
    }
    if (closest(redundant, vector) < redundancy) reservoir[redundant] = vector;
  }

  private newSpeaker(members: Embedding[]): Speaker {
    const speaker: Speaker = {
      id: this.nextSpeaker,
      centroid: new Float32Array(members[0].vector.length),
      weight: 0,
      reservoir: [],
      seconds: 0,
    };
    this.nextSpeaker += 1;
    this.speakers.set(speaker.id, speaker);
    for (const member of members) {
      this.learn(speaker, member);
      member.state = "accepted";
      member.speaker = speaker.id;
      member.score = this.score(member.vector, speaker);
    }
    return speaker;
  }

  /**
   * A new speaker only from a few mutually similar embeddings with enough
   * speech between them, so a cough, a laugh or a burst of music never
   * becomes a speaker.
   */
  private confirm(embedding: Embedding): void {
    const { high } = this.thresholds();
    const horizon = this.latest - 300;
    this.candidates = this.candidates
      .filter((each) => each.state !== "accepted" && each.t1 >= horizon)
      .slice(-64);
    if (this.speakers.size >= this.options.maxSpeakers) return;
    const group = [embedding];
    for (const other of this.candidates) {
      if (other === embedding || dot(other.vector, embedding.vector) < high)
        continue;
      if (group.some((member) => this.cannotLink(member.unit, other.unit)))
        continue;
      group.push(other);
    }
    if (group.length < this.options.confirmCount) return;
    const seconds = coverage(group.map((each) => [each.t0, each.t1]));
    const needed =
      this.options.confirmSeconds * (this.latest < this.relaxUntil ? 2 : 1);
    if (seconds < needed) return;
    const centroid = normalize(new Float32Array(embedding.vector.length));
    for (const member of group)
      for (let i = 0; i < centroid.length; i += 1)
        centroid[i] += member.quality * member.vector[i];
    normalize(centroid);
    let coherence = 0;
    for (const member of group)
      coherence += dot(member.vector, centroid) / group.length;
    // Not just a known speaker heard less clearly.
    for (const speaker of this.speakers.values()) {
      let mean = 0;
      for (const member of group)
        mean += this.score(member.vector, speaker) / group.length;
      if (mean >= high || mean >= coherence - 0.1) return;
    }
    this.newSpeaker(group);
    this.candidates = this.candidates.filter(
      (each) => each.state !== "accepted",
    );
    this.consolidate();
  }

  private noteApart(a: number, b: number): void {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    this.apart.set(key, (this.apart.get(key) ?? 0) + 1);
  }

  private apartCount(a: number, b: number): number {
    return this.apart.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0;
  }

  /** Different local speakers of one window are different people. */
  private cannotLink(a: Unit, b: Unit): boolean {
    return a.window === b.window && a.local !== b.local;
  }

  /** Speakers the unit cannot be: those of the other local speakers in its window. */
  private forbidden(unit: Unit): Set<number> {
    const result = new Set<number>();
    for (const other of unit.window.units) {
      if (other === unit) continue;
      const label = this.ownLabel(other);
      if (label?.speaker !== undefined && !label.provisional)
        result.add(label.speaker);
    }
    return result;
  }

  /** The helper heard the same voice carry on from `previous`. */
  private continueFrom(window: Window, previous: number): void {
    const unit = window.units[0];
    const before = this.windowById.get(previous);
    if (!unit || !before?.units.length) return;
    const last = before.units.reduce((a, b) => (b.t1 > a.t1 ? b : a));
    unit.links.push(last);
    last.links.push(unit);
  }

  /**
   * Links a new window's local speakers to the previous windows' where they
   * cover the same stretch of time: the same voice in both.
   */
  private stitch(window: Window): void {
    for (const previous of this.recent) {
      const from = Math.max(window.t0, previous.t0);
      const to = Math.min(window.t1, previous.t1);
      if (to - from < 0.5) continue;
      for (const unit of window.units) {
        const mine = this.within(unit, from, to);
        if (mine < 0.5) continue;
        let best: Unit | undefined;
        let bestShared = 0;
        for (const other of previous.units) {
          let shared = 0;
          for (const [a0, a1] of unit.spans)
            for (const [b0, b1] of other.spans)
              shared += overlap(Math.max(a0, from), Math.min(a1, to), b0, b1);
          if (shared > bestShared) {
            best = other;
            bestShared = shared;
          }
        }
        if (!best) continue;
        const theirs = this.within(best, from, to);
        if (
          bestShared >= 0.5 &&
          bestShared >= 0.5 * mine &&
          bestShared >= 0.5 * theirs
        ) {
          unit.links.push(best);
          best.links.push(unit);
        }
      }
    }
  }

  private within(unit: Unit, from: number, to: number): number {
    let total = 0;
    for (const [start, end] of unit.spans)
      total += overlap(start, end, from, to);
    return total;
  }

  private ownLabel(unit: Unit): UnitLabel | undefined {
    const embedding = unit.embedding;
    if (!embedding) return undefined;
    if (embedding.state === "accepted")
      return { speaker: this.resolve(embedding.speaker!), provisional: false };
    if (embedding.state === "ambiguous")
      return { speaker: this.resolve(embedding.speaker!), provisional: true };
    return { provisional: true };
  }

  /**
   * The speaker of the nearest linked unit (within 20 s) that has one: a
   * short turn without an embedding takes it from the same voice next door.
   */
  private inherited(unit: Unit, confidentOnly: boolean): number | undefined {
    const seen = new Set<Unit>([unit]);
    let frontier = [unit];
    let fallback: number | undefined;
    for (let depth = 0; depth < 16 && frontier.length; depth += 1) {
      const next: Unit[] = [];
      let found: { speaker: number; distance: number } | undefined;
      for (const current of frontier)
        for (const linked of current.links) {
          if (seen.has(linked)) continue;
          seen.add(linked);
          if (Math.abs(linked.t0 - unit.t0) > 20) continue;
          next.push(linked);
          const label = this.ownLabel(linked);
          if (label?.speaker === undefined) continue;
          if (label.provisional) {
            fallback ??= label.speaker;
            continue;
          }
          const distance = Math.abs(linked.t0 - unit.t0);
          if (!found || distance < found.distance)
            found = { speaker: label.speaker, distance };
        }
      if (found) return found.speaker;
      frontier = next;
    }
    return confidentOnly ? undefined : fallback;
  }

  private unitLabel(unit: Unit): UnitLabel {
    const own = this.ownLabel(unit);
    if (own && !own.provisional) return own;
    const inherited = this.inherited(unit, true);
    if (inherited !== undefined && !this.forbidden(unit).has(inherited))
      return { speaker: inherited, provisional: false };
    if (own?.speaker !== undefined) return own;
    const weak = this.inherited(unit, false);
    if (weak !== undefined) return { speaker: weak, provisional: true };
    return own ?? { provisional: true };
  }

  // MARK: Consolidation

  /**
   * Merges speakers that turned out to be one voice, over speaker models
   * only (a few dozen comparisons). History is not rewritten: the merged
   * speaker becomes an alias.
   */
  consolidate(): void {
    this.lastConsolidation = this.latest;
    this.stats.consolidations += 1;
    const { high, low } = this.thresholds();
    const expected = this.options.expectedSpeakers;
    for (;;) {
      const speakers = [...this.speakers.values()];
      let best: [Speaker, Speaker, number] | undefined;
      for (let i = 0; i < speakers.length; i += 1)
        for (let j = i + 1; j < speakers.length; j += 1) {
          const a = speakers[i];
          const b = speakers[j];
          if (this.apartCount(a.id, b.id) >= 2) continue;
          const link = this.linkage(a, b);
          if (!best || link > best[2]) best = [a, b, link];
        }
      if (!best) return;
      const needed =
        expected !== undefined && speakers.length > expected
          ? low + 0.1
          : high + 0.05;
      if (best[2] < needed) return;
      const [a, b] = best;
      const [keep, drop] = a.id < b.id ? [a, b] : [b, a];
      this.mergeModels(keep, drop);
    }
  }

  /** Average similarity between two speakers' voice samples. */
  private linkage(a: Speaker, b: Speaker): number {
    let sum = 0;
    for (const x of a.reservoir) for (const y of b.reservoir) sum += dot(x, y);
    return sum / Math.max(1, a.reservoir.length * b.reservoir.length);
  }

  private mergeModels(keep: Speaker, drop: Speaker): void {
    const total = keep.weight + drop.weight;
    for (let i = 0; i < keep.centroid.length; i += 1)
      keep.centroid[i] =
        (keep.weight * keep.centroid[i] + drop.weight * drop.centroid[i]) /
        total;
    normalize(keep.centroid);
    keep.weight = total;
    keep.seconds += drop.seconds;
    for (const vector of drop.reservoir) this.addExemplar(keep, vector);
    this.speakers.delete(drop.id);
    this.alias.set(drop.id, keep.id);
    this.pendingAliases.push([drop.id, keep.id]);
  }

  // MARK: Labels

  private windowAt(time: number): Window | undefined {
    for (const list of [this.windows.slow, this.windows.fast]) {
      let found: Window | undefined;
      for (
        let index = lowerBound(list, time, (each) => each.t1);
        index < list.length && list[index].t0 <= time + 15;
        index += 1
      ) {
        const window = list[index];
        if (window.t0 > time || window.t1 < time) continue;
        const near = window.units.some((unit) =>
          unit.spans.some(
            ([start, end]) => start - 0.3 <= time && time <= end + 0.3,
          ),
        );
        if (near && (!found || window.id > found.id)) found = window;
      }
      if (found) return found;
    }
    return undefined;
  }

  /** Who spoke at `time`: the speaker, a second one if they overlap. */
  /**
   * The embedding that speaks most directly for `time`: it covers the time,
   * so does its voice's turn, and the time is near its middle.
   */
  private evidenceAt(time: number): Embedding | undefined {
    let best: Embedding | undefined;
    let bestWeight = 0;
    const list = this.byStart;
    for (
      let index = lowerBound(list, time + 0.2, (each) => each.t0) - 1;
      index >= 0 && list[index].t0 >= time - 12;
      index -= 1
    ) {
      const embedding = list[index];
      if (embedding.state === "candidate" || time > embedding.t1 + 0.2)
        continue;
      if (
        !embedding.unit.spans.some(
          ([a, b]) => a - 0.3 <= time && time <= b + 0.3,
        )
      )
        continue;
      const half = (embedding.t1 - embedding.t0) / 2;
      const centrality =
        1 - Math.abs(time - (embedding.t0 + half)) / (half + 0.5);
      const weight =
        embedding.quality *
        Math.max(0.05, centrality) *
        (embedding.state === "accepted" ? 1 : 0.5);
      if (weight > bestWeight) {
        best = embedding;
        bestWeight = weight;
      }
    }
    return best;
  }

  /** Who spoke at `time`: the speaker, a second one if they overlap. */
  private speakerAt(
    start: number,
    end: number,
  ): { label: UnitLabel; overlap?: number } | undefined {
    const middle = (start + end) / 2;
    const window = this.windowAt(middle);
    const evidence = this.evidenceAt(middle);
    let label: UnitLabel | undefined = evidence
      ? this.unitLabel(evidence.unit)
      : undefined;
    // Overlap shows in a segmentation window: two voices over one word.
    let speaking: { unit: Unit; covered: number }[] = [];
    if (window) {
      const covering = window.units.map((unit) => {
        let covered = 0;
        let gap = Infinity;
        for (const [a, b] of unit.spans) {
          covered += overlap(a, b, start, end);
          gap = Math.min(gap, Math.max(0, a - end, start - b));
        }
        return { unit, covered, gap };
      });
      speaking = covering
        .filter((each) => each.covered > 0)
        .sort((a, b) => b.covered - a.covered);
      if (!label?.speaker) {
        const chosen =
          speaking[0] ??
          covering
            .filter((each) => each.gap <= 1)
            .sort((a, b) => a.gap - b.gap)[0];
        const fallback = chosen ? this.unitLabel(chosen.unit) : undefined;
        if (fallback && (fallback.speaker !== undefined || !label))
          label = fallback;
      }
    }
    if (!label) return undefined;
    const second =
      speaking.length > 1
        ? speaking
            .map((each) => this.unitLabel(each.unit).speaker)
            .find(
              (speaker) => speaker !== undefined && speaker !== label.speaker,
            )
        : undefined;
    return { label, ...(second !== undefined ? { overlap: second } : {}) };
  }

  private isEcho(segment: Segment): boolean {
    if (this.source !== "mic" || !this.echoes.length) return false;
    let echoed = 0;
    const from = lowerBound(this.echoes, segment.t0 - 30, (each) => each[1]);
    for (let index = from; index < this.echoes.length; index += 1) {
      const [a, b] = this.echoes[index];
      if (a > segment.t1) break;
      echoed += overlap(a, b, segment.t0, segment.t1);
    }
    return echoed > 0.5 * Math.max(0.1, segment.t1 - segment.t0);
  }

  /** The segment's turns, or undefined when they did not change. */
  private label(segment: Segment): DiarizerLabel | undefined {
    const words = segment.words.length
      ? segment.words
      : [[0, segment.t0, segment.t1] as const];
    type Run = { turn: LiveContextTurn; seconds: number };
    const runs: Run[] = [];
    for (const [offset, start, end] of words) {
      const found = this.speakerAt(start, end);
      if (!found) continue;
      const turn: LiveContextTurn = {
        offset: runs.length ? offset : 0,
        ...(found.label.speaker !== undefined
          ? { speaker: speakerKey(this.source, found.label.speaker) }
          : {}),
        ...(found.label.provisional ? { provisional: true } : {}),
        ...(found.overlap !== undefined
          ? { overlap: speakerKey(this.source, found.overlap) }
          : {}),
      };
      const seconds = Math.max(0.05, end - start);
      const last = runs.at(-1);
      if (
        last &&
        last.turn.speaker === turn.speaker &&
        !last.turn.overlap === !turn.overlap
      ) {
        last.seconds += seconds;
        if (!turn.provisional) delete last.turn.provisional;
      } else runs.push({ turn, seconds });
    }
    if (!runs.length) return undefined;
    // A blip shorter than half a second is more likely noise than a turn.
    for (let index = 0; runs.length > 1 && index < runs.length;) {
      if (
        runs[index].seconds >= this.options.minTurnSeconds ||
        runs[index].turn.overlap
      ) {
        index += 1;
        continue;
      }
      const into = index === 0 ? 1 : index - 1;
      runs[into].seconds += runs[index].seconds;
      if (index === 0) runs[1].turn.offset = 0;
      runs.splice(index, 1);
      for (let i = runs.length - 1; i > 0; i -= 1)
        if (
          runs[i].turn.speaker === runs[i - 1].turn.speaker &&
          !runs[i].turn.overlap === !runs[i - 1].turn.overlap
        ) {
          runs[i - 1].seconds += runs[i].seconds;
          runs.splice(i, 1);
        }
      index = 0;
    }
    const echo = this.isEcho(segment);
    const result = {
      turns: runs.map((run) => run.turn),
      ...(echo ? { echo: true } : {}),
    };
    const serialized = JSON.stringify(result);
    if (serialized === segment.emitted) return undefined;
    segment.emitted = serialized;
    return { id: segment.id, ...result };
  }

  // MARK: Final pass

  /**
   * At stop: agglomerative clustering (average linkage) over every stored
   * embedding of the session, grouped first into short stretches of one
   * linked voice. Window constraints and the user's renames and merges are
   * hard. Returns the labels that changed, over the whole session.
   */
  finish(
    user: DiarizerUserConstraints = { merges: new Map(), named: new Set() },
  ): DiarizerLabel[] {
    const assignment = finalPass(
      this.embeddings.filter((each) => !this.inEcho(each)),
      {
        resolve: (id) => this.resolve(id),
        user,
        component: componentsOf(this.embeddings.map((each) => each.unit)),
        nextSpeaker: () => this.nextSpeaker++,
        tauLow: this.thresholds().low,
      },
    );
    this.applyAssignment(assignment);
    this.finalized = true;
    return this.drain();
  }

  /** Replays a stored final pass. */
  applyAssignment(
    assignment: ReadonlyMap<number, number> | [number, number][],
  ): void {
    const map = assignment instanceof Map ? assignment : new Map(assignment);
    const dimension = this.embeddings[0]?.vector.length ?? 0;
    for (const embedding of this.embeddings) {
      const speaker = map.get(embedding.seq);
      if (speaker === undefined) continue;
      embedding.speaker = speaker;
      embedding.state = "accepted";
    }
    // Models rebuilt from the final labels seed the next capture.
    this.speakers.clear();
    this.alias.clear();
    for (const embedding of this.embeddings) {
      if (embedding.state !== "accepted" || embedding.speaker === undefined)
        continue;
      let speaker = this.speakers.get(embedding.speaker);
      if (!speaker) {
        speaker = {
          id: embedding.speaker,
          centroid: new Float32Array(dimension),
          weight: 0,
          reservoir: [],
          seconds: 0,
        };
        this.speakers.set(speaker.id, speaker);
        this.nextSpeaker = Math.max(this.nextSpeaker, speaker.id + 1);
      }
      this.learn(speaker, embedding);
    }
  }

  /** User merges within the source also merge the models. */
  applyUserMerges(merges: ReadonlyMap<number, number>): void {
    for (const [from, into] of merges) {
      const a = this.speakers.get(this.resolve(from));
      const b = this.speakers.get(this.resolve(into));
      if (a && b && a !== b) {
        this.mergeModels(b, a);
        this.pendingAliases.pop();
      }
    }
  }

  private inEcho(embedding: Embedding): boolean {
    return this.echoes.some(
      ([a, b]) =>
        overlap(a, b, embedding.t0, embedding.t1) >
        0.5 * (embedding.t1 - embedding.t0),
    );
  }
}

function componentsOf(units: Unit[]): Map<Unit, number> {
  const component = new Map<Unit, number>();
  let next = 0;
  for (const start of units) {
    if (component.has(start)) continue;
    const id = next++;
    const stack = [start];
    component.set(start, id);
    while (stack.length) {
      const unit = stack.pop()!;
      for (const linked of unit.links)
        if (!component.has(linked)) {
          component.set(linked, id);
          stack.push(linked);
        }
    }
  }
  return component;
}

interface FinalPassContext {
  resolve(id: number): number;
  user: DiarizerUserConstraints;
  component: Map<Unit, number>;
  nextSpeaker(): number;
  tauLow: number;
}

interface Atom {
  members: Embedding[];
  vector: Float32Array;
  weight: number;
  start: number;
  /** window id → local speaker */
  locals: Map<number, number>;
  group?: number;
}

const ATOM_SECONDS = 30;
const MAX_ATOMS = 1500;

/** The final pass's assignment of embeddings (by seq) to speakers. */
function finalPass(
  embeddings: Embedding[],
  context: FinalPassContext,
): Map<number, number> {
  const result = new Map<number, number>();
  const usable = embeddings.filter(
    (each) => each.state !== "candidate" || each.seconds >= 1,
  );
  if (!usable.length) return result;
  const online = (embedding: Embedding) =>
    embedding.speaker === undefined
      ? undefined
      : context.resolve(embedding.speaker);
  const userGroup = (speaker: number | undefined) => {
    if (speaker === undefined) return undefined;
    let current = speaker;
    for (let guard = 0; guard < 64; guard += 1) {
      const next = context.user.merges.get(current);
      if (next === undefined) break;
      current = next;
    }
    const touched =
      context.user.named.has(current) ||
      current !== speaker ||
      [...context.user.merges.values()].includes(current);
    return touched ? current : undefined;
  };

  // Atoms: up to 30 s of one linked voice with one online label.
  let span = ATOM_SECONDS;
  let atoms: Atom[] = [];
  for (;;) {
    atoms = [];
    const open = new Map<string, Atom>();
    for (const embedding of [...usable].sort((a, b) => a.t0 - b.t0)) {
      const speaker = online(embedding);
      const group = userGroup(speaker);
      const key = `${context.component.get(embedding.unit)}:${speaker ?? "?"}`;
      let atom = open.get(key);
      if (!atom || embedding.t0 - atom.start > span) {
        atom = {
          members: [],
          vector: new Float32Array(embedding.vector.length),
          weight: 0,
          start: embedding.t0,
          locals: new Map(),
          ...(group !== undefined ? { group } : {}),
        };
        open.set(key, atom);
        atoms.push(atom);
      }
      atom.members.push(embedding);
      atom.weight += embedding.quality;
      for (let i = 0; i < atom.vector.length; i += 1)
        atom.vector[i] += embedding.quality * embedding.vector[i];
      atom.locals.set(embedding.unit.window.id, embedding.unit.local);
    }
    if (atoms.length <= MAX_ATOMS) break;
    span *= 2;
  }
  for (const atom of atoms) normalize(atom.vector);

  // The stopping threshold follows how alike one voice's stretches are here.
  const intra: number[] = [];
  const byComponent = new Map<string, Atom>();
  for (const atom of atoms) {
    const key = `${context.component.get(atom.members[0].unit)}:${online(atom.members[0]) ?? "?"}`;
    const previous = byComponent.get(key);
    if (previous && online(atom.members[0]) !== undefined)
      intra.push(dot(previous.vector, atom.vector));
    byComponent.set(key, atom);
  }
  intra.sort((a, b) => a - b);
  const stop =
    intra.length >= 10
      ? Math.min(
          0.85,
          Math.max(0.5, intra[Math.floor(intra.length * 0.1)] - 0.05),
        )
      : 0.6;

  // Average-linkage agglomeration (Lance–Williams), cannot-links as −∞.
  const n = atoms.length;
  const conflict = (a: Atom, b: Atom) => {
    if (a.group !== undefined && b.group !== undefined && a.group !== b.group) {
      if (context.user.named.has(a.group) && context.user.named.has(b.group))
        return true;
    }
    const [small, large] = a.locals.size < b.locals.size ? [a, b] : [b, a];
    for (const [window, local] of small.locals) {
      const other = large.locals.get(window);
      if (other !== undefined && other !== local) return true;
    }
    return false;
  };
  const similarity = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1) {
      const value = conflict(atoms[i], atoms[j])
        ? -Infinity
        : dot(atoms[i].vector, atoms[j].vector);
      similarity[i * n + j] = value;
      similarity[j * n + i] = value;
    }
  const alive = new Uint8Array(n).fill(1);
  const size = atoms.map((atom) => atom.weight);
  const cluster = atoms.map((_, index) => [index]);
  const groupOf = atoms.map((atom) => atom.group);
  const merge = (i: number, j: number) => {
    for (let k = 0; k < n; k += 1) {
      if (!alive[k] || k === i || k === j) continue;
      const a = similarity[i * n + k];
      const b = similarity[j * n + k];
      const value =
        a === -Infinity || b === -Infinity
          ? -Infinity
          : (size[i] * a + size[j] * b) / (size[i] + size[j]);
      similarity[i * n + k] = value;
      similarity[k * n + i] = value;
    }
    size[i] += size[j];
    cluster[i].push(...cluster[j]);
    groupOf[i] ??= groupOf[j];
    alive[j] = 0;
  };
  // The user's merges and names hold: their atoms start as one cluster,
  // even where a window put them apart.
  const firstOfGroup = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const group = groupOf[i];
    if (group === undefined) continue;
    const first = firstOfGroup.get(group);
    if (first === undefined) firstOfGroup.set(group, i);
    else merge(first, i);
  }
  // Each row's best partner to its right, so a step costs O(n) instead of
  // a scan of every pair. Ties go to the first pair, as a full scan would.
  const rowBest = new Float64Array(n).fill(-Infinity);
  const rowPartner = new Int32Array(n).fill(-1);
  const refresh = (i: number) => {
    let best = -Infinity;
    let partner = -1;
    if (alive[i])
      for (let j = i + 1; j < n; j += 1) {
        if (!alive[j]) continue;
        const value = similarity[i * n + j];
        if (partner < 0 || value > best) {
          best = value;
          partner = j;
        }
      }
    rowBest[i] = best;
    rowPartner[i] = partner;
  };
  for (let i = 0; i < n; i += 1) refresh(i);
  for (;;) {
    let i = -1;
    for (let k = 0; k < n; k += 1)
      if (rowPartner[k] >= 0 && (i < 0 || rowBest[k] > rowBest[i])) i = k;
    if (i < 0 || rowBest[i] < stop) break;
    const j = rowPartner[i];
    const gi = groupOf[i];
    const gj = groupOf[j];
    if (gi !== undefined && gj !== undefined && gi !== gj) {
      // Two speakers the user kept apart.
      similarity[i * n + j] = -Infinity;
      similarity[j * n + i] = -Infinity;
      refresh(i);
      continue;
    }
    merge(i, j);
    rowPartner[j] = -1;
    refresh(i);
    for (let k = 0; k < n; k += 1) {
      if (k === i || !alive[k] || rowPartner[k] < 0) continue;
      if (rowPartner[k] === i || rowPartner[k] === j) refresh(k);
      else if (k < i) {
        const value = similarity[k * n + i];
        if (value > rowBest[k] || (value === rowBest[k] && i < rowPartner[k])) {
          rowBest[k] = value;
          rowPartner[k] = i;
        }
      }
    }
  }

  // Tiny clusters (under 2 s) join their closest neighbor rather than
  // becoming speakers of their own.
  const clusters = [...cluster.keys()].filter((index) => alive[index]);
  const seconds = (index: number) =>
    coverage(
      cluster[index].flatMap((atom) =>
        atoms[atom].members.map((m): [number, number] => [m.t0, m.t1]),
      ),
    );
  for (const index of clusters) {
    if (!alive[index] || groupOf[index] !== undefined || seconds(index) >= 2)
      continue;
    let best = -Infinity;
    let into = -1;
    for (const other of clusters)
      if (
        other !== index &&
        alive[other] &&
        similarity[index * n + other] > best
      ) {
        best = similarity[index * n + other];
        into = other;
      }
    if (into >= 0 && best >= context.tauLow) merge(into, index);
  }

  // Keep the numbers people have seen: each cluster takes the online
  // speaker it most overlaps, one to one; user groups keep theirs.
  const final = clusters.filter((index) => alive[index]);
  const votes: { index: number; speaker: number; weight: number }[] = [];
  for (const index of final) {
    const weights = new Map<number, number>();
    for (const atom of cluster[index])
      for (const member of atoms[atom].members) {
        const speaker = online(member);
        if (speaker !== undefined)
          weights.set(speaker, (weights.get(speaker) ?? 0) + member.quality);
      }
    for (const [speaker, weight] of weights)
      votes.push({ index, speaker, weight });
  }
  votes.sort((a, b) => b.weight - a.weight);
  const idOf = new Map<number, number>();
  const used = new Set<number>();
  for (const index of final) {
    const group = groupOf[index];
    if (group !== undefined && !used.has(group)) {
      idOf.set(index, group);
      used.add(group);
    }
  }
  for (const vote of votes) {
    if (idOf.has(vote.index) || used.has(vote.speaker)) continue;
    idOf.set(vote.index, vote.speaker);
    used.add(vote.speaker);
  }
  for (const index of final) {
    if (!idOf.has(index)) idOf.set(index, context.nextSpeaker());
    for (const atom of cluster[index])
      for (const member of atoms[atom].members)
        result.set(member.seq, idOf.get(index)!);
  }
  return result;
}

// MARK: Float16

/** Decodes the helper's base64 little-endian float16 vector. */
export function decodeFloat16(base64: string): Float32Array {
  const bytes = Buffer.from(base64, "base64");
  const result = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < result.length; i += 1) {
    const half = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    const sign = half & 0x8000 ? -1 : 1;
    const exponent = (half >> 10) & 0x1f;
    const fraction = half & 0x3ff;
    result[i] =
      exponent === 0
        ? sign * 2 ** -14 * (fraction / 1024)
        : exponent === 31
          ? fraction
            ? NaN
            : sign * Infinity
          : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
  }
  return result;
}

export function encodeFloat16(vector: Float32Array): string {
  const bytes = Buffer.alloc(vector.length * 2);
  const view = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < vector.length; i += 1) {
    view.setFloat32(0, vector[i]);
    const bits = view.getUint32(0);
    const sign = (bits >>> 16) & 0x8000;
    const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
    const fraction = bits & 0x7fffff;
    let half: number;
    if (exponent <= 0) half = sign;
    else if (exponent >= 31) half = sign | 0x7c00;
    else half = sign | (exponent << 10) | ((fraction + 0x1000) >> 13);
    bytes.writeUInt16LE(Math.min(half, sign | 0x7bff), 2 * i);
  }
  return bytes.toString("base64");
}

// MARK: Session

/** One record of the session's speaker file (`<session>.speakers.jsonl`). */
export type SpeakerRecord = Record<string, unknown> & { type: string };

export interface SourcedLabel extends DiarizerLabel {
  source: LiveContextSource;
}

const SOURCES: readonly LiveContextSource[] = ["mic", "system"];

function isSourceName(value: unknown): value is LiveContextSource {
  return SOURCES.some((source) => source === value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseWindowTurns(value: unknown): [number, number, number][] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (turn): turn is [number, number, number] =>
      Array.isArray(turn) && turn.length === 3 && turn.every(finite),
  );
}

function parseWords(value: unknown): [number, number, number][] {
  return parseWindowTurns(value);
}

/**
 * Both sources' speakers for one session: replays the stored speaker file,
 * takes the helper's events during a capture (returning what to store and
 * which labels changed), and runs the final pass at the end.
 */
export class SpeakerSession {
  private readonly diarizers: Record<LiveContextSource, SourceDiarizer>;
  /** Offset added to this capture's analyzer times. */
  private base = 0;
  private latest = 0;
  private hasCaptures = false;

  constructor(options: Partial<DiarizerOptions> = {}) {
    this.diarizers = {
      mic: new SourceDiarizer("mic", options),
      system: new SourceDiarizer("system", options),
    };
  }

  diarizer(source: LiveContextSource): SourceDiarizer {
    return this.diarizers[source];
  }

  /** Rebuilds the session's speakers from its stored records. */
  replay(records: readonly SpeakerRecord[]): void {
    for (const record of records) {
      if (record.type === "capture") {
        this.hasCaptures = true;
        this.base = finite(record.base) ? record.base : this.latest + 60;
        for (const diarizer of Object.values(this.diarizers))
          diarizer.beginCapture();
        continue;
      }
      if (record.type === "relabel") {
        if (isSourceName(record.source) && Array.isArray(record.labels))
          this.diarizers[record.source].applyAssignment(
            (record.labels as unknown[]).filter(
              (pair): pair is [number, number] =>
                Array.isArray(pair) && pair.length === 2 && pair.every(finite),
            ),
          );
        continue;
      }
      this.feed(record);
    }
    // Merges found while replaying are already in the transcript.
    for (const diarizer of Object.values(this.diarizers))
      diarizer.takeAliases();
  }

  /** A new capture; returns the record that starts it. */
  beginCapture(): SpeakerRecord {
    this.base = this.hasCaptures ? Math.ceil(this.latest + 60) : 0;
    this.hasCaptures = true;
    for (const diarizer of Object.values(this.diarizers))
      diarizer.beginCapture();
    return { type: "capture", base: this.base };
  }

  /** What the transcript already shows for a segment. */
  setEmitted(
    source: LiveContextSource,
    id: string,
    label: Omit<DiarizerLabel, "id">,
  ): void {
    this.diarizers[source].setEmitted(id, label);
  }

  /** The user's merges within a source also merge the voice models. */
  userMerged(from: string, into: string): void {
    const [fromSource, fromSpeaker] = from.split("-");
    const [intoSource, intoSpeaker] = into.split("-");
    if (fromSource !== intoSource || !isSourceName(fromSource)) return;
    this.diarizers[fromSource].applyUserMerges(
      new Map([[Number(fromSpeaker), Number(intoSpeaker)]]),
    );
  }

  /**
   * A helper event (with capture-relative times). Returns the record to
   * store, if any, and the labels that changed.
   */
  handle(
    event: Record<string, unknown>,
    segmentId?: string,
  ): {
    record?: SpeakerRecord;
    labels: SourcedLabel[];
    aliases: [string, string][];
  } {
    const record = this.toRecord(event, segmentId);
    if (!record) return { labels: [], aliases: [] };
    this.feed(record);
    const source = record.source as LiveContextSource;
    const diarizer = this.diarizers[source];
    const labels = diarizer.drain().map((label) => ({ ...label, source }));
    const aliases = diarizer
      .takeAliases()
      .map(([from, into]): [string, string] => [
        `${source}-${from}`,
        `${source}-${into}`,
      ]);
    // Volatile text is labeled live but only final segments are stored.
    const stored = record.type !== "segment" || event.final === true;
    return { ...(stored ? { record } : {}), labels, aliases };
  }

  private toRecord(
    event: Record<string, unknown>,
    segmentId?: string,
  ): SpeakerRecord | undefined {
    if (!isSourceName(event.source)) return undefined;
    const source = event.source;
    switch (event.type) {
      case "window":
        if (!finite(event.id) || !finite(event.t0) || !finite(event.t1))
          return undefined;
        return {
          type: "window",
          source,
          id: event.id,
          t0: event.t0,
          t1: event.t1,
          slow: event.slow === true,
          turns: parseWindowTurns(event.turns),
          ...(finite(event.after) ? { after: event.after } : {}),
        };
      case "embedding":
        if (
          !finite(event.window) ||
          !finite(event.local) ||
          !finite(event.t0) ||
          !finite(event.t1) ||
          typeof event.vector !== "string"
        )
          return undefined;
        return {
          type: "embedding",
          source,
          window: event.window,
          local: event.local,
          t0: event.t0,
          t1: event.t1,
          seconds: finite(event.seconds) ? event.seconds : event.t1 - event.t0,
          quality: finite(event.quality) ? event.quality : 0.5,
          vector: event.vector,
        };
      case "echo":
        if (!finite(event.t0) || !finite(event.t1)) return undefined;
        return { type: "echo", source, t0: event.t0, t1: event.t1 };
      case "device":
        return { type: "device", source };
      case "segment":
        if (!segmentId || !finite(event.a0) || !finite(event.a1))
          return undefined;
        return {
          type: "segment",
          source,
          id: segmentId,
          t0: event.a0,
          t1: event.a1,
          words: parseWords(event.words),
        };
      default:
        return undefined;
    }
  }

  private feed(record: SpeakerRecord): void {
    if (!isSourceName(record.source)) return;
    const diarizer = this.diarizers[record.source];
    const base = this.base;
    switch (record.type) {
      case "window": {
        if (!finite(record.id) || !finite(record.t0) || !finite(record.t1))
          return;
        this.latest = Math.max(this.latest, base + record.t1);
        diarizer.window({
          id: record.id,
          t0: base + record.t0,
          t1: base + record.t1,
          slow: record.slow === true,
          turns: parseWindowTurns(record.turns).map(
            ([start, end, local]): [number, number, number] => [
              base + start,
              base + end,
              local,
            ],
          ),
          ...(finite(record.after) ? { after: record.after } : {}),
        });
        return;
      }
      case "embedding": {
        if (
          !finite(record.window) ||
          !finite(record.local) ||
          !finite(record.t0) ||
          !finite(record.t1) ||
          typeof record.vector !== "string"
        )
          return;
        diarizer.embedding({
          window: record.window,
          local: record.local,
          t0: base + record.t0,
          t1: base + record.t1,
          seconds: finite(record.seconds)
            ? record.seconds
            : record.t1 - record.t0,
          quality: finite(record.quality) ? record.quality : 0.5,
          vector: decodeFloat16(record.vector),
        });
        return;
      }
      case "echo":
        if (finite(record.t0) && finite(record.t1))
          diarizer.echo(base + record.t0, base + record.t1);
        return;
      case "device":
        diarizer.deviceChanged();
        return;
      case "segment":
        if (
          typeof record.id !== "string" ||
          !finite(record.t0) ||
          !finite(record.t1)
        )
          return;
        diarizer.segment({
          id: record.id,
          t0: base + record.t0,
          t1: base + record.t1,
          words: parseWords(record.words).map(
            ([offset, start, end]): [number, number, number] => [
              offset,
              base + start,
              base + end,
            ],
          ),
        });
        return;
      default:
        return;
    }
  }

  /**
   * The final pass for both sources, with the user's edits as hard
   * constraints. Returns the changed labels and the records to store.
   */
  finish(speakers: {
    names: Partial<Record<string, string>>;
    merges: Partial<Record<string, string>>;
  }): { labels: SourcedLabel[]; records: SpeakerRecord[] } {
    const labels: SourcedLabel[] = [];
    const records: SpeakerRecord[] = [];
    for (const source of SOURCES) {
      const diarizer = this.diarizers[source];
      if (!diarizer.stats.embeddings) continue;
      const user = userConstraints(source, speakers);
      for (const label of diarizer.finish(user))
        labels.push({ ...label, source });
      records.push({ type: "relabel", source, labels: diarizer.assignments() });
    }
    return { labels, records };
  }
}

/** The user's renames and merges within one source, by speaker number. */
export function userConstraints(
  source: LiveContextSource,
  speakers: {
    names: Partial<Record<string, string>>;
    merges: Partial<Record<string, string>>;
  },
): DiarizerUserConstraints {
  const number = (key: string) => {
    const [keySource, speaker] = key.split("-");
    return keySource === source ? Number(speaker) : undefined;
  };
  const merges = new Map<number, number>();
  for (const [from, into] of Object.entries(speakers.merges)) {
    const a = number(from);
    const b = into ? number(into) : undefined;
    if (a !== undefined && b !== undefined) merges.set(a, b);
  }
  const resolve = (id: number) => {
    let current = id;
    for (let guard = 0; guard < 64 && merges.has(current); guard += 1)
      current = merges.get(current)!;
    return current;
  };
  const named = new Set<number>();
  for (const [key, name] of Object.entries(speakers.names)) {
    const id = number(key);
    if (id !== undefined && name) named.add(resolve(id));
  }
  return { merges, named };
}
