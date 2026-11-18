import { describe, expect, it } from "vitest";
import {
  aliasSpeaker,
  emptySpeakers,
  mergeSpeakers,
  parseTurns,
  renameSpeaker,
  resolveSpeaker,
  segmentTurns,
  speakerMap,
  speakersOf,
} from "../liveContextSpeakers";

describe("Live Context speakers", () => {
  it("reads stored turns and drops bad entries", () => {
    expect(
      parseTurns([
        { offset: 12, speaker: "system-2", overlap: "system-1" },
        { offset: 0, speaker: "system-1" },
        { offset: 5, provisional: true },
        { offset: -1, speaker: "system-3" },
        { offset: 4, speaker: "system-0" },
        { offset: 5.5, speaker: "system-1" },
        "nope",
      ]),
    ).toEqual([
      { offset: 0, speaker: "system-1" },
      { offset: 5, provisional: true },
      { offset: 12, speaker: "system-2", overlap: "system-1" },
    ]);
    expect(parseTurns([])).toBeUndefined();
    expect(parseTurns("x")).toBeUndefined();
  });

  it("resolves Pine's aliases before the user's merges", () => {
    let speakers = aliasSpeaker(emptySpeakers(), "mic-3", "mic-1");
    expect(resolveSpeaker("mic-3", speakerMap(speakers))).toBe("mic-1");
    // The user says 3 is really 2: that wins.
    speakers = { ...speakers, merges: { "mic-3": "mic-2" } };
    expect(resolveSpeaker("mic-3", speakerMap(speakers))).toBe("mic-2");
    expect(aliasSpeaker(speakers, "mic-1", "mic-1")).toBe(speakers);
  });

  it("keeps unknown, provisional and overlapping turns apart", () => {
    expect(
      segmentTurns({
        text: "嗯。对对对，我也这么想。",
        turns: [
          { offset: 0, provisional: true },
          { offset: 2, speaker: "mic-1", overlap: "mic-2" },
          { offset: 6, speaker: "mic-1" },
        ],
      }),
    ).toEqual([
      { provisional: true, text: "嗯。" },
      { speaker: "mic-1", overlap: "mic-2", text: "对对对，" },
      { speaker: "mic-1", text: "我也这么想。" },
    ]);
  });

  it("renames the speaker a key resolves to, and clears with an empty name", () => {
    let speakers = renameSpeaker(emptySpeakers(), "mic-1", "  Alice  ");
    expect(speakers.names).toEqual({ "mic-1": "Alice" });
    speakers = mergeSpeakers(speakers, "mic-2", "mic-1");
    speakers = renameSpeaker(speakers, "mic-2", "Alice Wang");
    expect(speakers.names).toEqual({ "mic-1": "Alice Wang" });
    expect(renameSpeaker(speakers, "mic-1", " ").names).toEqual({});
    expect(
      renameSpeaker(emptySpeakers(), "mic-1", "x".repeat(100)).names["mic-1"],
    ).toHaveLength(40);
  });

  it("merges through chains, across sources, and never into a cycle", () => {
    let speakers = renameSpeaker(emptySpeakers(), "system-3", "Bob");
    speakers = mergeSpeakers(speakers, "system-3", "system-2");
    // The unnamed target keeps the merged speaker's name.
    expect(speakers.names).toEqual({ "system-2": "Bob" });
    speakers = mergeSpeakers(speakers, "system-2", "mic-1");
    expect(resolveSpeaker("system-3", speakers.merges)).toBe("mic-1");
    // Merging back would loop; it changes nothing instead.
    expect(mergeSpeakers(speakers, "mic-1", "system-3")).toBe(speakers);
    expect(
      resolveSpeaker("mic-1", { "mic-1": "mic-2", "mic-2": "mic-1" }),
    ).toBe("mic-2");
  });

  it("splits a segment's text into turns, joining merged neighbors", () => {
    const segment = {
      text: "大家好。好的，上个月增长了。我补充一下。",
      turns: [
        { offset: 0, speaker: "system-1" as const },
        { offset: 4, speaker: "system-2" as const },
        { offset: 14, speaker: "system-3" as const },
      ],
    };
    expect(segmentTurns(segment)).toEqual([
      { speaker: "system-1", text: "大家好。" },
      { speaker: "system-2", text: "好的，上个月增长了。" },
      { speaker: "system-3", text: "我补充一下。" },
    ]);
    expect(segmentTurns(segment, { "system-3": "system-2" })).toEqual([
      { speaker: "system-1", text: "大家好。" },
      { speaker: "system-2", text: "好的，上个月增长了。我补充一下。" },
    ]);
    expect(segmentTurns({ text: "no labels" })).toEqual([
      { text: "no labels" },
    ]);
    // Offsets past the text are ignored; a late first turn covers the start.
    expect(
      segmentTurns({
        text: "abc",
        turns: [
          { offset: 1, speaker: "mic-1" },
          { offset: 9, speaker: "mic-2" },
        ],
      }),
    ).toEqual([{ speaker: "mic-1", text: "abc" }]);
  });

  it("lists speakers in order of appearance after merges", () => {
    expect(
      speakersOf(
        [
          { turns: [{ offset: 0, speaker: "mic-2" }] },
          {},
          {
            turns: [
              { offset: 0, speaker: "mic-1" },
              { offset: 3, speaker: "mic-3" },
            ],
          },
        ],
        { "mic-3": "mic-2" },
      ),
    ).toEqual(["mic-2", "mic-1"]);
  });
});
