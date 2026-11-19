import { describe, expect, it } from "vitest";
import type { LiveContextSegment, LiveContextSpeakers } from "../liveContext";
import {
  clockTime,
  estimateTokens,
  LIVE_CONTEXT_INLINE_MAX_TOKENS,
  LIVE_CONTEXT_READ_MAX_TOKENS,
  LIVE_CONTEXT_TAIL_MAX_TOKENS,
  lineTokens,
  liveContextIncrement,
  parseClockTime,
  readLiveContext,
  transcriptLines,
  type LiveContextAgentSource,
} from "../liveContextAgent";

/** 14:00:00 local time on a fixed day. */
const BASE = new Date(2026, 10, 19, 14, 0, 0).getTime();

function segment(
  index: number,
  text: string,
  extra: Partial<LiveContextSegment> = {},
): LiveContextSegment {
  return {
    id: `cap-system-${index}`,
    source: "system",
    start: BASE + index * 60_000,
    end: BASE + index * 60_000 + 5_000,
    text,
    final: true,
    ...extra,
  };
}

/** Alternating speakers, so lines do not merge. */
function talk(count: number, words = 12): LiveContextSegment[] {
  return Array.from({ length: count }, (_, index) =>
    segment(
      index,
      `Point ${index}: ${"lorem ipsum ".repeat(words / 2).trim()}.`,
      { turns: [{ offset: 0, speaker: index % 2 ? "system-2" : "system-1" }] },
    ),
  );
}

function source(
  segments: LiveContextSegment[],
  extra: Partial<LiveContextAgentSource> = {},
  speakers: LiveContextSpeakers = { names: {}, merges: {} },
): LiveContextAgentSource {
  return {
    transcript: { segments, speakers },
    now: BASE + 3_600_000,
    ...extra,
  };
}

const increment = (after?: string) => ({
  op: "increment" as const,
  ...(after ? { after } : {}),
});

const read = (extra: Record<string, unknown> = {}) => ({
  op: "read" as const,
  ...extra,
});

describe("liveContextIncrement", () => {
  it("is null without a final segment, even while capturing", () => {
    expect(liveContextIncrement(source([]), increment())).toBeNull();
    expect(
      liveContextIncrement(
        source([segment(0, "  ")], {
          capture: { state: "listening", sources: ["system"] },
        }),
        increment(),
      ),
    ).toBeNull();
    expect(readLiveContext(source([]), read())).toBeNull();
  });

  it("sends only lines after the cursor and moves the cursor", () => {
    const segments = talk(3);
    const first = liveContextIncrement(source(segments), increment());
    expect(first?.lines.map((line) => line.text.slice(0, 7))).toEqual([
      "Point 0",
      "Point 1",
      "Point 2",
    ]);
    expect(first?.cursor).toBe("cap-system-2");
    expect(first?.skipped).toBeUndefined();

    const later = liveContextIncrement(
      source([...segments, ...talk(4).slice(3)]),
      increment("cap-system-2"),
    );
    expect(later?.lines.map((line) => line.text.slice(0, 7))).toEqual([
      "Point 3",
    ]);
    expect(later?.cursor).toBe("cap-system-3");

    const none = liveContextIncrement(
      source(segments),
      increment("cap-system-2"),
    );
    expect(none?.lines).toEqual([]);
    expect(none?.skipped).toBeUndefined();
  });

  it("starts over when the cursor is gone", () => {
    const result = liveContextIncrement(
      source([segment(0, "Fresh start.", { id: "new-system-0" })]),
      increment("cap-system-9"),
    );
    expect(result?.cursorMissing).toBe(true);
    expect(result?.lines.map((line) => line.text)).toEqual(["Fresh start."]);
  });

  it("attaches a small increment in full and points to the tool for a large one", () => {
    const small = liveContextIncrement(source(talk(20)), increment());
    const smallTokens = (small?.lines ?? []).reduce(
      (sum, line) => sum + lineTokens(line),
      0,
    );
    expect(smallTokens).toBeLessThanOrEqual(LIVE_CONTEXT_INLINE_MAX_TOKENS);
    expect(small?.lines).toHaveLength(20);
    expect(small?.skipped).toBeUndefined();

    const segments = talk(200);
    const large = liveContextIncrement(source(segments), increment());
    const tail = large?.lines ?? [];
    expect(tail.length).toBeGreaterThan(0);
    expect(
      tail.reduce((sum, line) => sum + lineTokens(line), 0),
    ).toBeLessThanOrEqual(LIVE_CONTEXT_TAIL_MAX_TOKENS);
    expect(tail.at(-1)?.text).toContain("Point 199");
    expect(large?.skipped).toMatchObject({
      from: segments[0].start,
      to: segments[199 - tail.length].end,
      lines: 200 - tail.length,
      speakers: [
        { speaker: "Speaker 1 (system audio)", turns: expect.any(Number) },
        { speaker: "Speaker 2 (system audio)", turns: expect.any(Number) },
      ],
    });
    // The backlog is not re-sent next turn.
    expect(large?.cursor).toBe("cap-system-199");
  });

  it("keeps the end of a latest line too long for the tail", () => {
    const long = segment(1, `${"word ".repeat(3000)}final words.`);
    const result = liveContextIncrement(
      source([segment(0, "Earlier."), long]),
      increment(),
    );
    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0].text.startsWith("…")).toBe(true);
    expect(result?.lines[0].text.endsWith("final words.")).toBe(true);
    expect(lineTokens(result!.lines[0])).toBeLessThanOrEqual(
      LIVE_CONTEXT_TAIL_MAX_TOKENS,
    );
    // Both segments are one merged line, whose start is skipped.
    expect(result?.skipped).toMatchObject({ lines: 1, from: BASE });
  });

  it("labels speakers through aliases, merges and names", () => {
    const speakers: LiveContextSpeakers = {
      names: { "system-2": "Alice" },
      merges: { "system-3": "system-2" },
      aliases: { "system-4": "system-1" },
    };
    const segments = [
      segment(0, "Hello there. Hi Alice.", {
        turns: [
          { offset: 0, speaker: "system-4" },
          { offset: 13, speaker: "system-3" },
        ],
      }),
      segment(5, "Who is this?", { turns: [{ offset: 0 }] }),
    ];
    const result = liveContextIncrement(
      source(segments, {}, speakers),
      increment(),
    );
    expect(result?.lines.map((line) => [line.speaker, line.text])).toEqual([
      ["Speaker 1 (system audio)", "Hello there."],
      ["Alice (system audio)", "Hi Alice."],
      ["Unknown speaker (system audio)", "Who is this?"],
    ]);
    expect(result?.labels).toEqual({
      "system-3": "Alice (system audio)",
      "system-4": "Speaker 1 (system audio)",
    });
  });
});

describe("transcriptLines", () => {
  const none = { names: {}, merges: {} };

  it("merges one speaker's consecutive segments, CJK without spaces", () => {
    const lines = transcriptLines(
      [
        segment(0, "First part,"),
        segment(1, "second part."),
        segment(2, "下一步"),
        segment(3, "我们讨论预算。"),
        segment(9, "After a long pause."),
      ],
      none,
      true,
    );
    expect(lines.map((line) => line.text)).toEqual([
      "First part, second part.下一步我们讨论预算。",
      "After a long pause.",
    ]);
    expect(lines[0]).toMatchObject({
      at: BASE,
      end: BASE + 3 * 60_000 + 5_000,
      segmentId: "cap-system-3",
    });
  });

  it("drops echoes when system audio is captured, marks them otherwise", () => {
    const segments = [
      segment(0, "Sounds good.", { source: "mic", echo: true }),
      segment(1, "Next slide."),
    ];
    expect(transcriptLines(segments, none, true).map((l) => l.speaker)).toEqual(
      ["Others (system audio)"],
    );
    expect(
      transcriptLines(segments.slice(0, 1), none, false).map((line) => [
        line.speaker,
        line.echo,
      ]),
    ).toEqual([["Me (microphone)", true]]);
  });
});

describe("readLiveContext", () => {
  const segments = [
    segment(0, "Welcome everyone.", {
      turns: [{ offset: 0, speaker: "system-1" }],
    }),
    segment(5, "Budget is tight.", {
      turns: [{ offset: 0, speaker: "system-2" }],
    }),
    segment(10, "Ship on Friday.", {
      turns: [{ offset: 0, speaker: "system-1" }],
    }),
    segment(30, "Any questions?", {
      turns: [{ offset: 0, speaker: "system-2" }],
    }),
  ];
  const speakers = { names: { "system-2": "Bob" }, merges: {} };
  const texts = (extra: Record<string, unknown>) =>
    readLiveContext(source(segments, {}, speakers), read(extra))?.lines.map(
      (line) => line.text,
    );

  it("reads everything from the start without filters", () => {
    expect(texts({})).toEqual([
      "Welcome everyone.",
      "Budget is tight.",
      "Ship on Friday.",
      "Any questions?",
    ]);
  });

  it("reads a local time range", () => {
    expect(texts({ from: "14:05", to: "14:10:00" })).toEqual([
      "Budget is tight.",
      "Ship on Friday.",
    ]);
  });

  it("reads the last minutes, before now while capturing", () => {
    expect(texts({ lastMinutes: 5 })).toEqual(["Any questions?"]);
    const capturing = readLiveContext(
      source(segments, {
        capture: { state: "listening", sources: ["system"] },
        now: BASE + 45 * 60_000,
      }),
      read({ lastMinutes: 20 }),
    );
    expect(capturing?.lines.map((line) => line.text)).toEqual([
      "Any questions?",
    ]);
    expect(capturing?.header.state).toBe("listening");
  });

  it("filters by speaker label and text, merging what is left", () => {
    expect(texts({ speaker: "bob" })).toEqual([
      "Budget is tight.",
      "Any questions?",
    ]);
    expect(texts({ query: "friday" })).toEqual(["Ship on Friday."]);
  });

  it("pages at segment boundaries with a cursor until nothing is left", () => {
    const long = talk(150, 60);
    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = readLiveContext(
        source(long),
        read(cursor ? { cursor } : {}),
      );
      const tokens = (page?.lines ?? []).reduce(
        (sum, line) => sum + lineTokens(line),
        0,
      );
      expect(tokens).toBeLessThanOrEqual(LIVE_CONTEXT_READ_MAX_TOKENS);
      all.push(...(page?.lines ?? []).map((line) => line.text.slice(0, 10)));
      cursor = page?.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    expect(pages).toBeGreaterThan(1);
    expect(all).toEqual(long.map((each) => each.text.slice(0, 10)));
  });

  it("rejects malformed times and unknown cursors", () => {
    expect(() =>
      readLiveContext(source(segments), read({ from: "2pm" })),
    ).toThrow(/local time/);
    expect(() =>
      readLiveContext(source(segments), read({ cursor: "nope" })),
    ).toThrow(/cursor/);
  });
});

describe("helpers", () => {
  it("formats and parses local clock times", () => {
    expect(clockTime(BASE + 65_000)).toBe("14:01:05");
    expect(parseClockTime("14:01")).toBe(14 * 3600 + 60);
    expect(parseClockTime("9:05:07")).toBe(9 * 3600 + 5 * 60 + 7);
    expect(parseClockTime("25:00")).toBeUndefined();
  });

  it("counts CJK text about a token per character", () => {
    expect(estimateTokens("下一步我们")).toBe(5);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });
});
