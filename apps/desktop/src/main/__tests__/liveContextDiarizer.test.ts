import { describe, expect, it } from "vitest";
import {
  decodeFloat16,
  dot,
  encodeFloat16,
  normalize,
  SourceDiarizer,
  type DiarizerOptions,
} from "../liveContextDiarizer";

/**
 * Synthetic voices: each speaker is a direction in 192 dimensions and each
 * embedding that direction plus Gaussian noise. With noise σ the expected
 * similarity of two embeddings of one voice is 1 / (1 + σ²), and of two
 * voices ρ / (1 + σ²) for centroids ρ apart. The defaults match CAM++ on
 * real recordings (bench/diarization): one voice 0.6 alike (σ = 0.82;
 * headset meetings and readings, median 0.60–0.70), two voices 0.15
 * (ρ = 0.25; p90 0.28). Far-field audio is noisier: 0.45 within a voice
 * (σ = 1.1). `say` voices are far cleaner (0.83) and not used here.
 */
const DIM = 192;

function random(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gaussian = () =>
    Math.sqrt(-2 * Math.log(uniform() + 1e-12)) *
    Math.cos(2 * Math.PI * uniform());
  const direction = () =>
    normalize(Float32Array.from({ length: DIM }, gaussian));
  return { uniform, gaussian, direction };
}

interface Voice {
  name: string;
  centroid: Float32Array;
  noise: number;
}

function voices(
  seed: number,
  count: number,
  correlation = 0.25,
  noise = 0.82,
): Voice[] {
  const rng = random(seed);
  const shared = rng.direction();
  return Array.from({ length: count }, (_, index) => {
    const own = rng.direction();
    const centroid = normalize(
      shared.map(
        (x, i) =>
          Math.sqrt(correlation) * x + Math.sqrt(1 - correlation) * own[i],
      ),
    );
    return { name: String.fromCharCode(65 + index), centroid, noise };
  });
}

function sample(
  rng: ReturnType<typeof random>,
  voice: Voice,
  shift?: Float32Array,
): Float32Array {
  const scale = voice.noise / Math.sqrt(DIM);
  const vector = voice.centroid.map(
    (x, i) => x + scale * rng.gaussian() + (shift?.[i] ?? 0),
  );
  return normalize(vector);
}

interface Turn {
  voice: Voice | "noise";
  start: number;
  end: number;
}

/** Builds a conversation from turn lengths and pauses. */
function conversation(
  parts: [Voice | "noise", number, number?][],
  start = 0.5,
): Turn[] {
  const turns: Turn[] = [];
  let time = start;
  for (const [voice, seconds, gap = 0.4] of parts) {
    turns.push({ voice, start: time, end: time + seconds });
    time += seconds + gap;
  }
  return turns;
}

interface Simulation {
  diarizer: SourceDiarizer;
  /** segment id → who said it, word by word */
  truth: Map<string, { offset: number; voice: string }[]>;
  end: number;
}

/**
 * Plays turns into a diarizer the way the helper would: every 1.5 s, a
 * 3 s fast-path chunk while one voice keeps talking, else a 10 s
 * segmentation window with local speakers; embeddings only from at least
 * 1 s of clean speech; one segment per turn with a word every 0.5 s.
 */
function simulate(
  turns: Turn[],
  options: {
    seed?: number;
    diarizer?: SourceDiarizer;
    diarizerOptions?: Partial<DiarizerOptions>;
    shiftAfter?: number;
    shift?: Float32Array;
    onStep?: (time: number) => void;
    segmentsPerTurn?: boolean;
  } = {},
): Simulation {
  const rng = random(options.seed ?? 7);
  const diarizer =
    options.diarizer ?? new SourceDiarizer("system", options.diarizerOptions);
  const truth = new Map<string, { offset: number; voice: string }[]>();
  const end = Math.max(...turns.map((turn) => turn.end)) + 2;
  const hop = 1.5;
  let windowId = 0;
  let previousSingle: Voice | undefined;
  let segmentIndex = 0;
  const pendingSegments = [...turns]
    .filter((turn) => turn.voice !== "noise")
    .sort((a, b) => a.end - b.end);
  const speaking = (from: number, to: number) =>
    turns.filter((turn) => turn.end > from && turn.start < to);
  const shiftAt = (time: number) =>
    options.shift && time >= (options.shiftAfter ?? Infinity)
      ? options.shift
      : undefined;

  for (let time = 3; time <= end; time += hop) {
    options.onStep?.(time);
    const chunk = speaking(time - 3, time).filter(
      (turn) => turn.end - Math.max(turn.start, time - 3) > 0.05,
    );
    const only = chunk.length === 1 ? chunk[0] : undefined;
    const fast =
      only &&
      only.voice !== "noise" &&
      only.start <= time - 3 &&
      only.end >= time &&
      previousSingle === only.voice;
    if (fast) {
      const voice = only.voice as Voice;
      const id = windowId++;
      diarizer.window({
        id,
        t0: time - 3,
        t1: time,
        slow: false,
        turns: [[time - 3, time, 0]],
        after: id - 1,
      });
      diarizer.embedding({
        window: id,
        local: 0,
        t0: time - 3,
        t1: time,
        seconds: 3,
        quality: 1,
        vector: sample(rng, voice, shiftAt(time)),
      });
    } else if (chunk.length) {
      const t0 = Math.max(0, time - 10);
      const inWindow = speaking(t0, time);
      const locals = new Map<Turn["voice"], number>();
      const windowTurns: [number, number, number][] = [];
      for (const turn of inWindow) {
        if (!locals.has(turn.voice)) locals.set(turn.voice, locals.size);
        windowTurns.push([
          Math.max(t0, turn.start),
          Math.min(time, turn.end),
          locals.get(turn.voice)!,
        ]);
      }
      const id = windowId++;
      diarizer.window({ id, t0, t1: time, slow: true, turns: windowTurns });
      for (const [voice, local] of locals) {
        // Clean speech of this voice that is new in this hop, topped up
        // from the rest of the window, at most 3 s.
        const mine = inWindow.filter((turn) => turn.voice === voice);
        const others = inWindow.filter((turn) => turn.voice !== voice);
        const clean = mine.reduce((total, turn) => {
          let seconds = Math.min(time, turn.end) - Math.max(t0, turn.start);
          for (const other of others)
            seconds -= Math.max(
              0,
              Math.min(turn.end, other.end, time) -
                Math.max(turn.start, other.start, t0),
            );
          return total + Math.max(0, seconds);
        }, 0);
        const fresh = mine.some((turn) => turn.end > time - hop);
        if (!fresh || clean < 1) continue;
        const last = mine.at(-1)!;
        diarizer.embedding({
          window: id,
          local,
          t0: Math.max(t0, last.start),
          t1: Math.min(time, last.end),
          seconds: Math.min(3, clean),
          quality: Math.min(1, clean / 3),
          vector:
            voice === "noise"
              ? rng.direction()
              : sample(rng, voice, shiftAt(time)),
        });
      }
    }
    previousSingle = only && only.voice !== "noise" ? only.voice : undefined;
    // Segments become known a moment after they end.
    while (pendingSegments.length && pendingSegments[0].end <= time - 1) {
      const turn = pendingSegments.shift()!;
      const id = `s${segmentIndex++}`;
      const words: [number, number, number][] = [];
      for (
        let at = turn.start, offset = 0;
        at < turn.end;
        at += 0.5, offset += 2
      )
        words.push([offset, at, Math.min(turn.end, at + 0.45)]);
      diarizer.segment({ id, t0: turn.start, t1: turn.end, words });
      truth.set(id, [{ offset: 0, voice: (turn.voice as Voice).name }]);
    }
    diarizer.drain();
  }
  return { diarizer, truth, end };
}

/** Final labels vs truth, with the best one-to-one speaker mapping. */
function score(simulation: Simulation) {
  const labels = new Map<string, { offset: number; speaker?: string }[]>();
  for (const label of simulation.diarizer.finish())
    labels.set(label.id, label.turns);
  // Segments whose final labels did not change kept what drain() gave.
  const pairs: [string, string | undefined][] = [];
  for (const [id, truth] of simulation.truth) {
    const turns =
      labels.get(id) ?? lastLabels.get(simulation.diarizer)?.get(id) ?? [];
    const speaker = turns[0]?.speaker;
    pairs.push([
      truth[0].voice,
      speaker
        ? String(simulation.diarizer.resolve(Number(speaker.split("-")[1])))
        : undefined,
    ]);
  }
  const voicesSeen = [...new Set(pairs.map(([voice]) => voice))];
  const clusters = [
    ...new Set(pairs.map(([, cluster]) => cluster).filter(Boolean)),
  ] as string[];
  const counts = new Map<string, number>();
  for (const [voice, cluster] of pairs)
    if (cluster)
      counts.set(
        `${voice}|${cluster}`,
        (counts.get(`${voice}|${cluster}`) ?? 0) + 1,
      );
  // Greedy one-to-one mapping by count.
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const mapped = new Map<string, string>();
  const taken = new Set<string>();
  for (const [key] of sorted) {
    const [voice, cluster] = key.split("|");
    if (mapped.has(cluster) || taken.has(voice)) continue;
    mapped.set(cluster, voice);
    taken.add(voice);
  }
  const correct = pairs.filter(
    ([voice, cluster]) => cluster && mapped.get(cluster) === voice,
  ).length;
  const result = {
    accuracy: correct / pairs.length,
    speakers: clusters.length,
    voices: voicesSeen.length,
  };
  // PINE_DIARIZER_REPORT=1 prints the numbers docs/live-context.md quotes.
  if (process.env.PINE_DIARIZER_REPORT)
    console.info(
      expect.getState().currentTestName,
      result,
      simulation.diarizer.stats,
    );
  return result;
}

const lastLabels = new WeakMap<
  SourceDiarizer,
  Map<string, { offset: number; speaker?: string }[]>
>();

/** Wraps drain() to remember the latest labels per segment. */
function remember(diarizer: SourceDiarizer): SourceDiarizer {
  const store = new Map<string, { offset: number; speaker?: string }[]>();
  lastLabels.set(diarizer, store);
  const drain = diarizer.drain.bind(diarizer);
  const finish = diarizer.finish.bind(diarizer);
  diarizer.drain = () => {
    const labels = drain();
    for (const label of labels) store.set(label.id, label.turns);
    return labels;
  };
  diarizer.finish = (user) => {
    const labels = finish(user);
    for (const label of labels) store.set(label.id, label.turns);
    return labels;
  };
  return diarizer;
}

function alternating(
  people: Voice[],
  minutes: number,
  seconds: () => number,
  gap = 0.4,
) {
  const parts: [Voice, number, number][] = [];
  let total = 0;
  for (let index = 0; total < minutes * 60; index += 1) {
    const length = seconds();
    parts.push([people[index % people.length], length, gap]);
    total += length + gap;
  }
  return parts;
}

describe("Live Context speaker clustering", () => {
  it("keeps a single long lecture as one speaker, despite slow drift", () => {
    const [teacher] = voices(1, 1);
    const rng = random(2);
    const drift = rng.direction().map((x) => x * 0.35);
    // Sentences with breathing pauses, for 40 minutes.
    const parts: [Voice, number, number][] = [];
    for (let total = 0; total < 40 * 60;) {
      const length = 4 + rng.uniform() * 10;
      parts.push([teacher, length, 0.3 + rng.uniform()]);
      total += length + 1;
    }
    const simulation = simulate(conversation(parts), {
      diarizer: remember(new SourceDiarizer("system")),
      shiftAfter: 20 * 60,
      shift: drift,
    });
    const result = score(simulation);
    expect(result.speakers).toBe(1);
    expect(result.accuracy).toBeGreaterThan(0.97);
    // Most of a lecture never needs segmentation.
    const { windows, slowWindows } = simulation.diarizer.stats;
    expect(slowWindows / windows).toBeLessThan(0.5);
  });

  it("separates four ordinary voices in a meeting", () => {
    const people = voices(3, 4);
    const rng = random(4);
    const simulation = simulate(
      conversation(alternating(people, 8, () => 3 + rng.uniform() * 9)),
      { diarizer: remember(new SourceDiarizer("system")) },
    );
    const result = score(simulation);
    expect(result.speakers).toBe(4);
    expect(result.accuracy).toBeGreaterThan(0.95);
  });

  it("tells two similar voices apart", () => {
    // Embeddings across the two voices are 0.3 alike, as similar as the
    // closest pairs of real voices in our clips (p90 0.28).
    const people = voices(5, 2, 0.5);
    const rng = random(6);
    const simulation = simulate(
      conversation(alternating(people, 8, () => 4 + rng.uniform() * 8)),
      { diarizer: remember(new SourceDiarizer("system")) },
    );
    const result = score(simulation);
    expect(result.speakers).toBe(2);
    expect(result.accuracy).toBeGreaterThan(0.85);
  });

  it("adds a late joiner after 30 minutes", () => {
    const [a, b, c] = voices(7, 3);
    const rng = random(8);
    const parts = alternating([a, b], 30, () => 3 + rng.uniform() * 8);
    parts.push(...alternating([c, a, b], 5, () => 3 + rng.uniform() * 8));
    const simulation = simulate(conversation(parts), {
      diarizer: remember(new SourceDiarizer("system")),
    });
    const result = score(simulation);
    expect(result.speakers).toBe(3);
    expect(result.accuracy).toBeGreaterThan(0.95);
  });

  it("labels rapid back-and-forth with short replies", () => {
    const [a, b] = voices(9, 2);
    const rng = random(10);
    const parts: [Voice, number, number][] = [];
    for (let total = 0; total < 6 * 60;) {
      // A talks, B answers briefly ("嗯", "对", "yeah"), sometimes at length.
      const long = 2 + rng.uniform() * 4;
      const short =
        rng.uniform() < 0.6
          ? 0.4 + rng.uniform() * 0.5
          : 1.5 + rng.uniform() * 3;
      parts.push([a, long, 0.2], [b, short, 0.2]);
      total += long + short + 0.4;
    }
    const simulation = simulate(conversation(parts), {
      diarizer: remember(new SourceDiarizer("system")),
    });
    const result = score(simulation);
    expect(result.speakers).toBe(2);
    expect(result.accuracy).toBeGreaterThan(0.8);
  });

  it("marks overlapping speech", () => {
    const [a, b] = voices(11, 2);
    const turns: Turn[] = [];
    for (let time = 0.5; time < 300; time += 14) {
      turns.push({ voice: a, start: time, end: time + 8 });
      // B starts a second before A finishes.
      turns.push({ voice: b, start: time + 7, end: time + 13 });
    }
    const diarizer = remember(new SourceDiarizer("system"));
    const overlaps: string[] = [];
    simulate(turns, { diarizer });
    diarizer.finish();
    for (const turns of lastLabels.get(diarizer)!.values())
      for (const turn of turns as { overlap?: string }[])
        if (turn.overlap) overlaps.push(turn.overlap);
    expect(diarizer.speakerCount).toBe(2);
    expect(overlaps.length).toBeGreaterThan(0);
  });

  it("never makes a speaker out of laughter, music or noise", () => {
    const [a, b] = voices(12, 2);
    const rng = random(13);
    const parts: [Voice | "noise", number, number][] = [];
    for (let total = 0; total < 8 * 60;) {
      const length = 3 + rng.uniform() * 6;
      parts.push([rng.uniform() < 0.5 ? a : b, length, 0.5]);
      // A burst between turns, long enough to be embedded.
      if (rng.uniform() < 0.3)
        parts.push(["noise", 1.1 + rng.uniform() * 0.6, 0.5]);
      total += length + 2;
    }
    const simulation = simulate(conversation(parts), {
      diarizer: remember(new SourceDiarizer("system")),
    });
    const result = score(simulation);
    expect(result.speakers).toBe(2);
  });

  it("flags mic segments that are mostly loudspeaker echo", () => {
    const diarizer = new SourceDiarizer("mic");
    diarizer.echo(10, 20);
    diarizer.window({ id: 0, t0: 9, t1: 19, slow: true, turns: [[10, 19, 0]] });
    diarizer.segment({ id: "e", t0: 10, t1: 18, words: [[0, 10, 18]] });
    diarizer.segment({ id: "n", t0: 30, t1: 34, words: [[0, 30, 34]] });
    diarizer.window({
      id: 1,
      t0: 28,
      t1: 35,
      slow: true,
      turns: [[30, 34, 0]],
    });
    const labels = new Map(diarizer.drain().map((label) => [label.id, label]));
    expect(labels.get("e")?.echo).toBe(true);
    expect(labels.get("n")?.echo).toBeUndefined();
  });

  it("separates people on a far-field room mic", () => {
    // A conference room: four people on one mic, noisier embeddings
    // (0.45 alike within a voice, 0.11 across).
    const people = voices(14, 4, 0.25, 1.1);
    const rng = random(15);
    const simulation = simulate(
      conversation(alternating(people, 10, () => 3 + rng.uniform() * 9)),
      { diarizer: remember(new SourceDiarizer("mic")) },
    );
    const result = score(simulation);
    expect(result.speakers).toBeGreaterThanOrEqual(3);
    expect(result.speakers).toBeLessThanOrEqual(5);
    expect(result.accuracy).toBeGreaterThan(0.85);
  });

  it("keeps speaker numbers across a pause", () => {
    const [a, b] = voices(16, 2);
    const rng = random(17);
    const diarizer = remember(new SourceDiarizer("system"));
    const first = simulate(
      conversation(alternating([a, b], 3, () => 4 + rng.uniform() * 5)),
      {
        diarizer,
      },
    );
    diarizer.finish();
    const before = new Map(lastLabels.get(diarizer));
    // The next capture: window ids restart, time goes on.
    diarizer.beginCapture();
    const second = simulate(
      conversation(
        alternating([a, b], 3, () => 4 + rng.uniform() * 5),
        first.end + 60,
      ),
      { diarizer, seed: 99 },
    );
    // Same two speakers, same numbers.
    expect(diarizer.speakerCount).toBe(2);
    const firstA = before.get(
      [...first.truth].find(([, t]) => t[0].voice === "A")![0],
    )![0].speaker;
    const after = lastLabels.get(diarizer)!;
    const secondA = [...second.truth]
      .filter(([, t]) => t[0].voice === "A")
      .map(([id]) => after.get(id)?.[0]?.speaker);
    expect(
      secondA.filter((speaker) => speaker === firstA).length / secondA.length,
    ).toBeGreaterThan(0.9);
  });

  it("survives a headset switch without inventing speakers", () => {
    const [a, b] = voices(18, 2);
    const rng = random(19);
    // The new device colors every voice the same way.
    const shift = random(20)
      .direction()
      .map((x) => x * 0.6);
    const diarizer = remember(new SourceDiarizer("mic"));
    let switched = false;
    const simulation = simulate(
      conversation(alternating([a, b], 8, () => 3 + rng.uniform() * 8)),
      {
        diarizer,
        shiftAfter: 240,
        shift,
        onStep: (time) => {
          if (!switched && time >= 240) {
            switched = true;
            diarizer.deviceChanged();
          }
        },
      },
    );
    const result = score(simulation);
    expect(result.speakers).toBeLessThanOrEqual(3);
    expect(result.accuracy).toBeGreaterThan(0.85);
  });

  it("replays deterministically from stored embeddings", () => {
    const people = voices(21, 3);
    const rng = random(22);
    const turns = conversation(
      alternating(people, 4, () => 3 + rng.uniform() * 8),
    );
    const run = () => {
      const diarizer = new SourceDiarizer("system");
      simulate(turns, { diarizer });
      return { labels: diarizer.finish(), assignments: diarizer.assignments() };
    };
    expect(run()).toEqual(run());
  });

  it("stays flat over a three-hour session", () => {
    const people = voices(23, 3);
    const rng = random(24);
    const turns = conversation(
      alternating(people, 180, () => 3 + rng.uniform() * 12),
    );
    const diarizer = new SourceDiarizer("system");
    const times: number[] = [];
    let last = performance.now();
    simulate(turns, {
      diarizer,
      onStep: () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
      },
    });
    const started = performance.now();
    diarizer.finish();
    const finalPass = performance.now() - started;
    const mean = (list: number[]) =>
      list.reduce((a, b) => a + b, 0) / list.length;
    const early = mean(times.slice(100, 1100));
    const late = mean(times.slice(-1000));
    // Per-step cost does not grow with the session.
    expect(late).toBeLessThan(Math.max(0.5, early * 3));
    expect(diarizer.speakerCount).toBe(3);
    expect(finalPass).toBeLessThan(5000);
    if (process.env.PINE_DIARIZER_REPORT)
      console.info("3 h", { early, late, finalPass, ...diarizer.stats });
  }, 60_000);

  it("respects the user's names and merges in the final pass", () => {
    const [a, b] = voices(25, 2);
    const turns = () => {
      const rng = random(26);
      return conversation(alternating([a, b], 5, () => 4 + rng.uniform() * 6));
    };
    const shown = (diarizer: SourceDiarizer) => [
      ...new Set(diarizer.assignments().map(([, speaker]) => speaker)),
    ];
    const named = new SourceDiarizer("system");
    simulate(turns(), { diarizer: named });
    expect(named.speakerCount).toBe(2);
    const [first, second] = shown(named);
    named.finish({ merges: new Map(), named: new Set([first, second]) });
    expect(named.speakerCount).toBe(2);
    // The user said the second is the first: never split again.
    const merged = new SourceDiarizer("system");
    simulate(turns(), { diarizer: merged });
    merged.finish({ merges: new Map([[second, first]]), named: new Set() });
    expect(merged.speakerCount).toBe(1);
    expect(shown(merged)).toEqual([first]);
  });

  it("caps speakers by the user's hint", () => {
    const people = voices(27, 4);
    const rng = random(28);
    const simulation = simulate(
      conversation(alternating(people, 6, () => 3 + rng.uniform() * 8)),
      {
        diarizer: remember(
          new SourceDiarizer("system", { expectedSpeakers: 2 }),
        ),
      },
    );
    expect(simulation.diarizer.speakerCount).toBeLessThanOrEqual(3);
  });

  it("keeps a far-field lecture as one speaker, with no split sentences", () => {
    // A talk across a room: noisy embeddings, the voice drifting as the
    // speaker turns and moves.
    const [teacher] = voices(30, 1, 0.25, 1.1);
    const rng = random(31);
    const drift = rng.direction().map((x) => x * 0.5);
    const parts: [Voice, number, number][] = [];
    for (let total = 0; total < 30 * 60;) {
      const length = 3 + rng.uniform() * 12;
      parts.push([teacher, length, 0.3 + rng.uniform() * 1.5]);
      total += length + 1;
    }
    const diarizer = remember(new SourceDiarizer("mic"));
    const simulation = simulate(conversation(parts), {
      diarizer,
      shiftAfter: 15 * 60,
      shift: drift,
    });
    // Every label as it was first shown, not just at the end.
    const shown = new Set<string>();
    const drain = diarizer.drain.bind(diarizer);
    diarizer.drain = () => {
      const labels = drain();
      for (const label of labels)
        for (const turn of label.turns)
          if (turn.speaker) shown.add(turn.speaker);
      return labels;
    };
    const result = score(simulation);
    expect(result.speakers).toBe(1);
    expect(shown.size).toBeLessThanOrEqual(1);
    for (const turns of lastLabels.get(diarizer)!.values())
      expect(turns).toHaveLength(1);
  });

  it("labels words it has not analyzed yet with the voice next to them", () => {
    const [a] = voices(32, 1);
    const rng = random(33);
    const diarizer = new SourceDiarizer("mic");
    // Nothing analyzed yet: the voice is unknown, not "Me".
    diarizer.segment({ id: "early", t0: 0, t1: 2, words: [[0, 0, 2]] });
    expect(diarizer.drain()).toEqual([
      { id: "early", turns: [{ offset: 0, provisional: true }] },
    ]);
    for (let id = 0; id < 8; id += 1) {
      const t0 = 2 + id * 1.5;
      diarizer.window({
        id,
        t0,
        t1: t0 + 3,
        slow: false,
        turns: [[t0, t0 + 3, 0]],
        ...(id ? { after: id - 1 } : {}),
      });
      diarizer.embedding({
        window: id,
        local: 0,
        t0,
        t1: t0 + 3,
        seconds: 3,
        quality: 1,
        vector: sample(rng, a),
      });
    }
    // Words past the analyzed audio carry on the last voice, provisionally.
    diarizer.segment({
      id: "late",
      t0: 10,
      t1: 20,
      words: [
        [0, 10, 12],
        [10, 15.5, 20],
      ],
    });
    const late = diarizer.drain().find((label) => label.id === "late");
    expect(late?.turns).toEqual([{ offset: 0, speaker: "mic-1" }]);
    diarizer.segment({ id: "later", t0: 40, t1: 42, words: [[0, 40, 42]] });
    expect(
      diarizer.drain().find((label) => label.id === "later")?.turns,
    ).toEqual([{ offset: 0, speaker: "mic-1", provisional: true }]);
  });

  it("round-trips float16 vectors", () => {
    const vector = random(29).direction();
    const decoded = decodeFloat16(encodeFloat16(vector));
    expect(dot(vector, normalize(decoded))).toBeGreaterThan(0.9999);
  });
});
