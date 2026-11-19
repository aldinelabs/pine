/**
 * Speaker clustering for Live Context, in the main process. The helper
 * sends what it measured (analysis windows with local speakers, voice
 * embeddings, echo); everything that decides who is who lives here, as pure
 * and deterministic logic, so a session can be replayed from its stored
 * embeddings and tested without audio. See docs/live-context.md §3.4.
 *
 * Who is who is decided again and again over the whole session, not once
 * per embedding: stretches of one linked voice ("atoms") are clustered by
 * average linkage every time new evidence arrives, and the clusters are
 * mapped onto the speaker numbers already on screen. A voice that merges
 * into another becomes an alias of it, so the transcript never gains a
 * speaker that is really someone it already shows.
 *
 * Times are seconds on one clock per source: each capture's analyzer time
 * plus an offset that keeps captures of a session apart.
 */
import type { LiveContextSource, LiveContextTurn } from "../shared/liveContext";
import { speakerKey } from "../shared/liveContextSpeakers";

export interface DiarizerOptions {
  /** Average similarity at which two stretches of speech are one voice. */
  threshold: number;
  /** A must-link (the same local speaker in overlapping windows) holds only this similar. */
  linkFloor: number;
  /** A voice that is not yet a speaker joins the closest one this similar. */
  absorb: number;
  /** Beyond the first, a speaker needs this much speech… */
  minSpeakerSeconds: number;
  /** …in this many separate stretches, */
  minSpeakerStretches: number;
  /** …or in one, if it is less alike than this to every speaker. */
  distinctBelow: number;
  maxSpeakers: number;
  /** "About N people": caps speakers at N + 1. */
  expectedSpeakers?: number;
  /** One stretch of linked voice spans at most this long. */
  atomSeconds: number;
  /** Older stretches of one speaker are combined beyond this many. */
  maxAtoms: number;
  /** Re-cluster at most this often (audio seconds). */
  reclusterSeconds: number;
  /** Labels change live only this far back; older ones only by alias or the final pass. */
  liveSeconds: number;
  /** Shorter turns join a neighbor. */
  minTurnSeconds: number;
  /** Different local speakers of one window are kept apart unless this similar. */
  cannotLinkBelow: number;
  /** An embedding moves to another speaker that sounds this much more like it. */
  reassignMargin: number;
}

export const DEFAULT_DIARIZER_OPTIONS: DiarizerOptions = {
  threshold: 0.5,
  linkFloor: 0.25,
  absorb: 0.3,
  minSpeakerSeconds: 6,
  minSpeakerStretches: 2,
  distinctBelow: 0.1,
  maxSpeakers: 12,
  atomSeconds: 20,
  maxAtoms: 400,
  reclusterSeconds: 1.5,
  liveSeconds: 120,
  minTurnSeconds: 1,
  cannotLinkBelow: 0.6,
  reassignMargin: 0,
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

interface Embedding {
  seq: number;
  unit: Unit;
  t0: number;
  t1: number;
  seconds: number;
  quality: number;
  vector: Float32Array;
  atom?: Atom;
  /** The speaker shown for it, before aliases. */
  speaker?: number;
  /** A best guess: its voice is not (yet) clustered with that speaker. */
  tentative?: boolean;
}

/** Up to `atomSeconds` of one voice, linked across windows. */
interface Atom {
  id: number;
  members: Embedding[];
  /** Quality-weighted sum of the members' vectors. */
  sum: Float32Array;
  weight: number;
  t0: number;
  t1: number;
  /** window id → local speaker, for cannot-links. */
  locals: Map<number, number>;
  /** Several atoms combined (long sessions): never split again. */
  coarse: boolean;
  /** Bumped when members join; keys the caches below. */
  version: number;
  vector?: { version: number; value: Float32Array };
  /** Similarity to atoms with a higher id: [value, version, theirs]. */
  similar: Map<number, [number, number, number]>;
}

interface Segment extends DiarizerSegmentInput {
  emitted?: string;
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

function normalized(vector: Float32Array): Float32Array {
  return normalize(Float32Array.from(vector));
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

/**
 * Average-linkage agglomeration (Lance–Williams) with cannot-links as −∞,
 * groups that start merged, and groups that never merge with each other.
 * Each row caches its best partner to the right, so a step is O(n).
 * Returns the clusters (indices into the input) and the final linkage
 * between any two of them.
 */
export function agglomerate(input: {
  vectors: readonly Float32Array[];
  weights: readonly number[];
  threshold: number;
  conflict(i: number, j: number): boolean;
  /** Defaults to the vectors' dot product. */
  similarity?(i: number, j: number): number;
  /** Same group: start as one cluster. */
  group?: readonly (number | undefined)[];
  /** Two groups that must stay apart. */
  apart?(a: number, b: number): boolean;
}): { clusters: number[][]; linkage: (i: number, j: number) => number } {
  const n = input.vectors.length;
  const similarity = new Float32Array(n * n);
  for (let i = 0; i < n; i += 1)
    for (let j = i + 1; j < n; j += 1) {
      const value = input.conflict(i, j)
        ? -Infinity
        : (input.similarity?.(i, j) ?? dot(input.vectors[i], input.vectors[j]));
      similarity[i * n + j] = value;
      similarity[j * n + i] = value;
    }
  const alive = new Uint8Array(n).fill(1);
  const size = [...input.weights];
  const cluster = input.vectors.map((_, index) => [index]);
  const groupOf = input.group ? [...input.group] : new Array<undefined>(n);
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
  const firstOfGroup = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const group = groupOf[i];
    if (group === undefined) continue;
    const first = firstOfGroup.get(group);
    if (first === undefined) firstOfGroup.set(group, i);
    else merge(first, i);
  }
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
    if (i < 0 || rowBest[i] < input.threshold) break;
    const j = rowPartner[i];
    const gi = groupOf[i];
    const gj = groupOf[j];
    if (
      gi !== undefined &&
      gj !== undefined &&
      gi !== gj &&
      input.apart?.(gi, gj)
    ) {
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
  const clusters: number[][] = [];
  for (let i = 0; i < n; i += 1) if (alive[i]) clusters.push(cluster[i]);
  const root = new Int32Array(n);
  for (let i = 0; i < n; i += 1)
    if (alive[i]) for (const member of cluster[i]) root[member] = i;
  return {
    clusters,
    linkage: (a, b) => similarity[root[a] * n + root[b]],
  };
}

/** A cluster of atoms after one round of clustering. */
interface Cluster {
  atoms: Atom[];
  /** Index of its first atom, for `linkage`. */
  head: number;
  seconds: number;
  weight: number;
  vector: Float32Array;
  promoted: boolean;
  group?: number;
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
  private atoms: Atom[] = [];
  private nextAtom = 0;
  /** Speakers shown so far (unaliased), with their voice. */
  private readonly speakers = new Map<number, Float32Array>();
  private readonly alias = new Map<number, number>();
  private readonly pendingAliases: [number, number][] = [];
  /** The user's merges, kept together in every round. */
  private readonly userMerges = new Map<number, number>();
  private readonly segments = new Map<string, Segment>();
  private readonly segmentOrder: Segment[] = [];
  private readonly echoes: [number, number][] = [];
  private nextSpeaker = 1;
  private latest = 0;
  private dirty = false;
  private lastRecluster = -Infinity;
  /** Window ids are per capture; this keeps them apart. */
  private windowBase = 0;
  private maxWindowId = 0;
  private finalized = false;
  /** Counters for the performance report. */
  readonly stats = {
    windows: 0,
    slowWindows: 0,
    embeddings: 0,
    reclusters: 0,
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
    this.finalized = false;
  }

  /** The audio device changed: what follows is not linked to what came before. */
  deviceChanged(): void {
    this.recent = [];
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
    };
    this.embeddings.push(embedding);
    let at = this.byStart.length;
    while (at > 0 && this.byStart[at - 1].t0 > embedding.t0) at -= 1;
    this.byStart.splice(at, 0, embedding);
    unit.embedding = embedding;
    this.stats.embeddings += 1;
    if (this.inEcho(embedding)) return;
    this.place(embedding);
    // Until the next round, the closest speaker it sounds like.
    embedding.speaker = this.closest(embedding.vector);
    embedding.tentative = true;
    this.dirty = true;
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
    this.update();
    return this.pendingAliases.splice(0);
  }

  /** Segments of the last `liveSeconds` whose labels changed. */
  drain(): DiarizerLabel[] {
    this.update();
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
      const next = this.alias.get(current) ?? this.userMerges.get(current);
      if (next === undefined) return current;
      current = next;
    }
    return current;
  }

  /** Who spoke at `time` (for evaluation): the resolved speaker, if known. */
  speakerAtTime(
    time: number,
  ): { speaker?: number; overlap?: number } | undefined {
    this.update();
    const found = this.speakerAt(time - 0.005, time + 0.005);
    if (!found) return undefined;
    return {
      ...(found.speaker !== undefined
        ? { speaker: this.resolve(found.speaker) }
        : {}),
      ...(found.overlap !== undefined
        ? { overlap: this.resolve(found.overlap) }
        : {}),
    };
  }

  /** Speakers shown now, after merges. */
  get speakerCount(): number {
    this.update();
    return new Set([...this.speakers.keys()].map((id) => this.resolve(id)))
      .size;
  }

  /** Each stored embedding's speaker, for persisting the final pass. */
  assignments(): [seq: number, speaker: number][] {
    this.update();
    return this.embeddings
      .filter((each) => each.speaker !== undefined)
      .map((each) => [each.seq, this.resolve(each.speaker!)]);
  }

  // MARK: Atoms

  private atomVector(atom: Atom): Float32Array {
    if (atom.vector?.version !== atom.version)
      atom.vector = { version: atom.version, value: normalized(atom.sum) };
    return atom.vector.value;
  }

  /** Two atoms' similarity, kept until either changes. */
  private atomSimilarity(a: Atom, b: Atom): number {
    const [low, high] = a.id < b.id ? [a, b] : [b, a];
    const cached = low.similar.get(high.id);
    if (cached && cached[1] === low.version && cached[2] === high.version)
      return cached[0];
    const value = dot(this.atomVector(low), this.atomVector(high));
    low.similar.set(high.id, [value, low.version, high.version]);
    return value;
  }

  /** Joins the atom of a linked unit's embedding, or starts a new one. */
  private place(embedding: Embedding): void {
    const atom = this.linkedAtom(embedding.unit);
    if (
      atom &&
      !atom.coarse &&
      embedding.t1 - atom.t0 <= this.options.atomSeconds &&
      dot(embedding.vector, this.atomVector(atom)) >= this.options.linkFloor &&
      atom.locals.get(embedding.unit.window.id) === undefined
    ) {
      this.addToAtom(atom, embedding);
      return;
    }
    const fresh: Atom = {
      id: this.nextAtom++,
      members: [],
      sum: new Float32Array(embedding.vector.length),
      weight: 0,
      t0: embedding.t0,
      t1: embedding.t1,
      locals: new Map(),
      coarse: false,
      version: 0,
      similar: new Map(),
    };
    this.atoms.push(fresh);
    this.addToAtom(fresh, embedding);
  }

  private addToAtom(atom: Atom, embedding: Embedding): void {
    atom.members.push(embedding);
    atom.weight += embedding.quality;
    for (let i = 0; i < atom.sum.length; i += 1)
      atom.sum[i] += embedding.quality * embedding.vector[i];
    atom.t0 = Math.min(atom.t0, embedding.t0);
    atom.t1 = Math.max(atom.t1, embedding.t1);
    atom.locals.set(embedding.unit.window.id, embedding.unit.local);
    atom.version += 1;
    embedding.atom = atom;
  }

  /** The atom of the latest embedding reachable over must-links (within 20 s). */
  private linkedAtom(unit: Unit): Atom | undefined {
    const seen = new Set<Unit>([unit]);
    let frontier = [unit];
    let found: Embedding | undefined;
    for (let depth = 0; depth < 8 && frontier.length; depth += 1) {
      const next: Unit[] = [];
      for (const current of frontier)
        for (const linked of current.links) {
          if (seen.has(linked) || Math.abs(linked.t0 - unit.t0) > 20) continue;
          seen.add(linked);
          next.push(linked);
          const embedding = linked.embedding;
          if (embedding?.atom && (!found || embedding.t1 > found.t1))
            found = embedding;
        }
      frontier = next;
    }
    return found?.atom;
  }

  /**
   * Pairs of atoms (i * n + j, i < j) holding different local speakers of
   * one window: two people, unless their voices are clearly one
   * (segmentation now and then splits one voice; see `cannotLinkBelow`).
   */
  private conflicts(atoms: readonly Atom[]): Set<number> {
    const byWindow = new Map<number, [number, number][]>();
    atoms.forEach((atom, index) => {
      for (const [window, local] of atom.locals) {
        const list = byWindow.get(window);
        if (list) list.push([index, local]);
        else byWindow.set(window, [[index, local]]);
      }
    });
    const pairs = new Set<number>();
    for (const list of byWindow.values())
      for (let x = 0; x < list.length; x += 1)
        for (let y = x + 1; y < list.length; y += 1) {
          const [i, a] = list[x];
          const [j, b] = list[y];
          if (a !== b && i !== j)
            pairs.add(Math.min(i, j) * atoms.length + Math.max(i, j));
        }
    return pairs;
  }

  /** Long sessions: old atoms of one speaker close in time become one. */
  private coarsen(): void {
    if (this.atoms.length <= this.options.maxAtoms) return;
    const target = Math.floor(this.options.maxAtoms * 0.75);
    const atoms = [...this.atoms].sort((a, b) => a.t0 - b.t0);
    const speakerOf = (atom: Atom) => {
      const counts = new Map<number, number>();
      for (const member of atom.members)
        if (member.speaker !== undefined) {
          const id = this.resolve(member.speaker);
          counts.set(id, (counts.get(id) ?? 0) + member.quality);
        }
      return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
    };
    // Each old atom joins the last earlier one of its speaker within
    // `span`; the span doubles until few enough remain.
    let current = atoms;
    for (let span = 120; current.length > target && span <= 3600; span *= 2) {
      const horizon = this.latest - 300;
      const last = new Map<number, Atom>();
      const kept: Atom[] = [];
      let merged = 0;
      for (const atom of current) {
        const speaker = atom.t1 < horizon ? speakerOf(atom) : undefined;
        const into = speaker === undefined ? undefined : last.get(speaker);
        if (
          into &&
          atom.t1 - into.t0 <= span &&
          current.length - merged > target
        ) {
          for (const member of atom.members) this.addToAtom(into, member);
          into.coarse = true;
          merged += 1;
          continue;
        }
        if (speaker !== undefined) last.set(speaker, atom);
        kept.push(atom);
      }
      current = kept;
    }
    const alive = new Set(current.map((atom) => atom.id));
    for (const atom of current)
      for (const id of atom.similar.keys())
        if (!alive.has(id)) atom.similar.delete(id);
    this.atoms = current;
  }

  // MARK: Clustering

  /** The shown speaker whose voice is closest, if it is close enough. */
  private closest(vector: Float32Array): number | undefined {
    let best: number | undefined;
    let bestScore = this.options.absorb;
    for (const [id, voice] of this.speakers) {
      if (this.resolve(id) !== id) continue;
      const score = dot(vector, voice);
      if (score >= bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  private update(): void {
    if (!this.dirty) return;
    // Long sessions re-cluster less often: about 10 s apart at 400 atoms.
    const every = Math.max(
      this.options.reclusterSeconds,
      this.atoms.length / 40,
    );
    if (!this.finalized && this.latest - this.lastRecluster < every) return;
    this.recluster();
  }

  /**
   * One round: cluster every atom of the session, decide which clusters
   * are speakers, and map them onto the numbers already shown.
   */
  private recluster(user?: DiarizerUserConstraints): void {
    this.dirty = false;
    this.lastRecluster = this.latest;
    this.stats.reclusters += 1;
    this.coarsen();
    const atoms = this.atoms;
    if (!atoms.length) return;
    const vectors = atoms.map((atom) => this.atomVector(atom));
    // The user's merges (and, at the end, names) hold.
    const userGroup = (atom: Atom): number | undefined => {
      const counts = new Map<number, number>();
      for (const member of atom.members)
        if (member.speaker !== undefined) {
          const id = this.resolve(member.speaker);
          counts.set(id, (counts.get(id) ?? 0) + member.quality);
        }
      const top = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
      if (top === undefined) return undefined;
      const merged = [...this.userMerges.values()].map((id) =>
        this.resolve(id),
      );
      const touched =
        merged.includes(top) ||
        user?.named.has(top) ||
        [...(user?.merges.values() ?? [])].includes(top);
      return touched ? top : undefined;
    };
    const group = atoms.map(userGroup);
    const conflicts = this.conflicts(atoms);
    const { clusters: indices, linkage } = agglomerate({
      vectors,
      weights: atoms.map((atom) => atom.weight),
      threshold: this.options.threshold,
      similarity: (i, j) => this.atomSimilarity(atoms[i], atoms[j]),
      conflict: (i, j) =>
        conflicts.has(i * atoms.length + j) &&
        this.atomSimilarity(atoms[i], atoms[j]) < this.options.cannotLinkBelow,
      group,
      apart: (a, b) => Boolean(user?.named.has(a) && user.named.has(b)),
    });
    const clusters: Cluster[] = indices.map((members) => {
      const vector = new Float32Array(vectors[0].length);
      let weight = 0;
      for (const index of members) {
        weight += atoms[index].weight;
        for (let i = 0; i < vector.length; i += 1)
          vector[i] += atoms[index].sum[i];
      }
      const spans = members.flatMap((index) =>
        atoms[index].members.map((m): [number, number] => [m.t0, m.t1]),
      );
      return {
        atoms: members.map((index) => atoms[index]),
        head: members[0],
        seconds: coverage(spans),
        weight,
        vector: normalize(vector),
        promoted: false,
        group: members
          .map((index) => group[index])
          .find((g) => g !== undefined),
      };
    });

    // Which clusters are speakers: the largest always; others once they
    // have spoken enough, in more than one stretch or in a voice unlike any
    // speaker's, or the user made them.
    const previous = (cluster: Cluster) => {
      const counts = new Map<number, number>();
      for (const atom of cluster.atoms)
        for (const member of atom.members)
          if (member.speaker !== undefined) {
            const id = this.resolve(member.speaker);
            counts.set(id, (counts.get(id) ?? 0) + member.quality);
          }
      return counts;
    };
    const bySize = [...clusters].sort((a, b) => b.seconds - a.seconds);
    const distinct = (cluster: Cluster) =>
      bySize.every(
        (other) =>
          other === cluster ||
          !other.promoted ||
          linkage(cluster.head, other.head) < this.options.distinctBelow,
      );
    for (const cluster of bySize)
      cluster.promoted =
        cluster === bySize[0] ||
        cluster.group !== undefined ||
        (cluster.seconds >= this.options.minSpeakerSeconds &&
          (cluster.atoms.length >= this.options.minSpeakerStretches ||
            distinct(cluster)));
    // At most `maxSpeakers`: the closest speakers merge.
    for (;;) {
      const promoted = clusters.filter((each) => each.promoted);
      if (promoted.length <= this.options.maxSpeakers) break;
      let best: [Cluster, Cluster, number] | undefined;
      for (let i = 0; i < promoted.length; i += 1)
        for (let j = i + 1; j < promoted.length; j += 1) {
          const value = linkage(promoted[i].head, promoted[j].head);
          if (!best || value > best[2])
            best = [promoted[i], promoted[j], value];
        }
      if (!best) break;
      const [keep, drop] =
        best[0].seconds >= best[1].seconds
          ? [best[0], best[1]]
          : [best[1], best[0]];
      keep.atoms.push(...drop.atoms);
      keep.seconds += drop.seconds;
      drop.atoms = [];
      drop.promoted = false;
      drop.seconds = 0;
    }

    // Numbers people have seen stay: each speaker cluster takes the shown
    // speaker it shares most with, one to one.
    const live = clusters.filter((each) => each.promoted && each.atoms.length);
    const votes: { cluster: Cluster; speaker: number; weight: number }[] = [];
    for (const cluster of live)
      for (const [speaker, weight] of previous(cluster))
        votes.push({ cluster, speaker, weight });
    votes.sort((a, b) => b.weight - a.weight || a.speaker - b.speaker);
    const idOf = new Map<Cluster, number>();
    const used = new Set<number>();
    for (const cluster of live)
      if (cluster.group !== undefined && !used.has(cluster.group)) {
        idOf.set(cluster, cluster.group);
        used.add(cluster.group);
      }
    for (const vote of votes) {
      if (idOf.has(vote.cluster) || used.has(vote.speaker)) continue;
      idOf.set(vote.cluster, vote.speaker);
      used.add(vote.speaker);
    }
    for (const cluster of live)
      if (!idOf.has(cluster)) idOf.set(cluster, this.nextSpeaker++);

    // A shown speaker whose voice now mostly lives in another speaker's
    // cluster has turned out to be that speaker: an alias, not a relabel.
    const homes = new Map<number, Map<number, number>>();
    for (const cluster of live)
      for (const [speaker, weight] of previous(cluster)) {
        const home = homes.get(speaker) ?? new Map<number, number>();
        const id = idOf.get(cluster)!;
        home.set(id, (home.get(id) ?? 0) + weight);
        homes.set(speaker, home);
      }
    for (const [speaker, home] of homes) {
      if (used.has(speaker) || this.resolve(speaker) !== speaker) continue;
      const into = [...home].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (into === undefined || into === speaker) continue;
      this.alias.set(speaker, into);
      this.pendingAliases.push([speaker, into]);
    }

    // Voices that are not speakers (yet) take the closest speaker's number
    // when they are close enough; the rest stay unknown.
    const assign = (
      cluster: Cluster,
      id: number | undefined,
      tentative: boolean,
    ) => {
      for (const atom of cluster.atoms)
        for (const member of atom.members) {
          member.speaker = id;
          member.tentative = tentative;
        }
    };
    for (const cluster of live) assign(cluster, idOf.get(cluster), false);
    for (const cluster of clusters) {
      if (cluster.promoted || !cluster.atoms.length) continue;
      let best: Cluster | undefined;
      let bestScore = this.options.absorb;
      for (const other of live) {
        const value = linkage(cluster.head, other.head);
        const score = value === -Infinity ? -Infinity : value;
        if (score >= bestScore) {
          best = other;
          bestScore = score;
        }
      }
      assign(cluster, best ? idOf.get(best) : undefined, true);
    }
    this.speakers.clear();
    for (const cluster of live)
      this.speakers.set(idOf.get(cluster)!, cluster.vector);
    // Stretches are clustered whole; one embedding of a stretch that
    // clearly sounds like another speaker goes there. Combined old
    // stretches have settled and are left alone.
    if (this.speakers.size > 1)
      for (const atom of atoms) {
        if (atom.coarse) continue;
        for (const member of atom.members) {
          if (member.speaker === undefined) continue;
          const own = this.speakers.get(member.speaker);
          if (!own) continue;
          const mine = dot(member.vector, own);
          let best = member.speaker;
          let bestScore = mine + this.options.reassignMargin;
          for (const [id, voice] of this.speakers) {
            const score = dot(member.vector, voice);
            if (id !== member.speaker && score > bestScore) {
              best = id;
              bestScore = score;
            }
          }
          member.speaker = best;
        }
      }
  }

  // MARK: Links

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

  /** The embedding that names the unit's speaker: its own, else the nearest linked one. */
  private unitEvidence(unit: Unit): Embedding | undefined {
    if (unit.embedding?.speaker !== undefined) return unit.embedding;
    const seen = new Set<Unit>([unit]);
    let frontier = [unit];
    for (let depth = 0; depth < 16 && frontier.length; depth += 1) {
      const next: Unit[] = [];
      let found: { embedding: Embedding; distance: number } | undefined;
      for (const current of frontier)
        for (const linked of current.links) {
          if (seen.has(linked)) continue;
          seen.add(linked);
          if (Math.abs(linked.t0 - unit.t0) > 20) continue;
          next.push(linked);
          const embedding = linked.embedding;
          if (embedding?.speaker === undefined) continue;
          const distance = Math.abs(linked.t0 - unit.t0);
          if (!found || distance < found.distance)
            found = { embedding, distance };
        }
      if (found) return found.embedding;
      frontier = next;
    }
    return undefined;
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
      if (embedding.speaker === undefined || time > embedding.t1 + 0.2)
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
      const weight = embedding.quality * Math.max(0.05, centrality);
      if (weight > bestWeight) {
        best = embedding;
        bestWeight = weight;
      }
    }
    return best;
  }

  /** Who spoke over [start, end]: the speaker, a second one if they overlap. */
  private speakerAt(
    start: number,
    end: number,
  ): { speaker?: number; tentative?: boolean; overlap?: number } | undefined {
    const middle = (start + end) / 2;
    const window = this.windowAt(middle);
    const evidence = this.evidenceAt(middle);
    let named = evidence ? this.unitEvidence(evidence.unit) : undefined;
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
      if (!named) {
        const chosen =
          speaking[0] ??
          covering
            .filter((each) => each.gap <= 1)
            .sort((a, b) => a.gap - b.gap)[0];
        if (chosen) named = this.unitEvidence(chosen.unit);
      }
    }
    const speaker = named?.speaker;
    if (speaker === undefined && !window && !evidence) return undefined;
    const second =
      speaking.length > 1
        ? speaking
            .map((each) => this.unitEvidence(each.unit)?.speaker)
            .find(
              (each) =>
                each !== undefined &&
                speaker !== undefined &&
                this.resolve(each) !== this.resolve(speaker),
            )
        : undefined;
    return {
      ...(speaker !== undefined ? { speaker } : {}),
      ...(named?.tentative ? { tentative: true } : {}),
      ...(second !== undefined ? { overlap: second } : {}),
    };
  }

  /** The last speaker heard before `time`. */
  private speakerBefore(time: number): number | undefined {
    const list = this.byStart;
    for (
      let index = lowerBound(list, time, (each) => each.t0) - 1;
      index >= 0;
      index -= 1
    )
      if (list[index].speaker !== undefined) return list[index].speaker;
    return undefined;
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
    type Run = {
      offset: number;
      speaker?: number;
      overlap?: number;
      provisional: boolean;
      /** Not analyzed yet (else: analyzed, a voice not known yet). */
      pending: boolean;
      seconds: number;
    };
    const runs: Run[] = [];
    for (const [offset, start, end] of words) {
      const found = this.speakerAt(start, end);
      const speaker =
        found?.speaker !== undefined ? this.resolve(found.speaker) : undefined;
      const second =
        found?.overlap !== undefined ? this.resolve(found.overlap) : undefined;
      const seconds = Math.max(0.05, end - start);
      const pending = found === undefined;
      const last = runs.at(-1);
      if (
        last &&
        last.speaker === speaker &&
        last.overlap === second &&
        last.pending === pending
      ) {
        last.seconds += seconds;
        if (found?.tentative !== true && speaker !== undefined)
          last.provisional = false;
      } else
        runs.push({
          offset: runs.length ? offset : 0,
          ...(speaker !== undefined ? { speaker } : {}),
          ...(second !== undefined ? { overlap: second } : {}),
          provisional: speaker === undefined || found?.tentative === true,
          pending,
          seconds,
        });
    }
    // Words not analyzed yet carry on the voice next to them, for now.
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (run.speaker !== undefined || !run.pending) continue;
      const fill =
        runs
          .slice(0, index)
          .reverse()
          .find((each) => each.speaker !== undefined)?.speaker ??
        runs.slice(index + 1).find((each) => each.speaker !== undefined)
          ?.speaker ??
        this.speakerBefore(segment.t0);
      if (fill !== undefined) run.speaker = this.resolve(fill);
    }
    const merge = () => {
      for (let i = runs.length - 1; i > 0; i -= 1)
        if (
          runs[i].speaker === runs[i - 1].speaker &&
          runs[i].overlap === runs[i - 1].overlap
        ) {
          runs[i - 1].seconds += runs[i].seconds;
          runs[i - 1].provisional &&= runs[i].provisional;
          runs.splice(i, 1);
        }
    };
    merge();
    // A turn shorter than `minTurnSeconds` is more likely noise than a turn.
    for (;;) {
      if (runs.length < 2) break;
      let shortest = -1;
      for (let index = 0; index < runs.length; index += 1)
        if (
          runs[index].seconds < this.options.minTurnSeconds &&
          !runs[index].overlap &&
          (shortest < 0 || runs[index].seconds < runs[shortest].seconds)
        )
          shortest = index;
      if (shortest < 0) break;
      const into =
        shortest === 0
          ? 1
          : shortest === runs.length - 1
            ? shortest - 1
            : runs[shortest - 1].seconds >= runs[shortest + 1].seconds
              ? shortest - 1
              : shortest + 1;
      runs[into].seconds += runs[shortest].seconds;
      if (shortest === 0) runs[1].offset = 0;
      runs.splice(shortest, 1);
      merge();
    }
    const echo = this.isEcho(segment);
    const result = {
      turns: runs.map((run): LiveContextTurn => ({
        offset: run.offset,
        ...(run.speaker !== undefined
          ? { speaker: speakerKey(this.source, run.speaker) }
          : {}),
        ...(run.provisional ? { provisional: true } : {}),
        ...(run.overlap !== undefined
          ? { overlap: speakerKey(this.source, run.overlap) }
          : {}),
      })),
      ...(echo ? { echo: true } : {}),
    };
    const serialized = JSON.stringify(result);
    if (serialized === segment.emitted) return undefined;
    segment.emitted = serialized;
    return { id: segment.id, ...result };
  }

  // MARK: Final pass

  /**
   * At stop: one more round over the whole session with the user's renames
   * and merges as hard constraints. Returns the labels that changed, over
   * the whole session.
   */
  finish(
    user: DiarizerUserConstraints = { merges: new Map(), named: new Set() },
  ): DiarizerLabel[] {
    for (const [from, into] of user.merges) this.userMerges.set(from, into);
    this.recluster(user);
    this.finalized = true;
    return this.drain();
  }

  /** Replays a stored final pass. */
  applyAssignment(
    assignment: ReadonlyMap<number, number> | [number, number][],
  ): void {
    const map = assignment instanceof Map ? assignment : new Map(assignment);
    for (const embedding of this.embeddings) {
      const speaker = map.get(embedding.seq);
      if (speaker === undefined) continue;
      embedding.speaker = speaker;
      this.nextSpeaker = Math.max(this.nextSpeaker, speaker + 1);
    }
    this.dirty = false;
    this.speakers.clear();
    const sums = new Map<number, Float32Array>();
    for (const embedding of this.embeddings) {
      if (embedding.speaker === undefined) continue;
      const id = this.resolve(embedding.speaker);
      const sum = sums.get(id) ?? new Float32Array(embedding.vector.length);
      for (let i = 0; i < sum.length; i += 1)
        sum[i] += embedding.quality * embedding.vector[i];
      sums.set(id, sum);
    }
    for (const [id, sum] of sums) this.speakers.set(id, normalize(sum));
  }

  /** The user's merges within the source hold from now on. */
  applyUserMerges(merges: ReadonlyMap<number, number>): void {
    for (const [from, into] of merges)
      if (this.resolve(from) !== this.resolve(into))
        this.userMerges.set(this.resolve(from), this.resolve(into));
    this.dirty = true;
  }

  private inEcho(embedding: Embedding): boolean {
    return this.echoes.some(
      ([a, b]) =>
        overlap(a, b, embedding.t0, embedding.t1) >
        0.5 * (embedding.t1 - embedding.t0),
    );
  }
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
