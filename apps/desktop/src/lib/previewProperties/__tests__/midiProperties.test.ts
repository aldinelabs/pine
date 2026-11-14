import { describe, expect, it } from "vitest";
import { midiProperties } from "../midiProperties";

describe("midiProperties", () => {
  it("reports title, playable tracks, tempo and time signature", () => {
    expect(
      midiProperties(
        {
          name: " Minuet ",
          header: {
            tempos: [{ bpm: 119.6 }, { bpm: 90 }],
            timeSignatures: [{ timeSignature: [3, 4] }],
          },
          tracks: [{ notes: [] }, { notes: [1, 2] }, { notes: [3] }],
        },
        (bpm) => `${bpm} BPM`,
      ),
    ).toEqual([
      { key: "title", value: "Minuet" },
      { key: "tracks", type: "number", value: 2 },
      { key: "tempo", value: "120 BPM" },
      { key: "timeSignature", value: "3/4" },
    ]);
  });

  it("leaves out what the file does not record", () => {
    expect(
      midiProperties(
        { name: "", header: { tempos: [], timeSignatures: [] }, tracks: [] },
        String,
      ),
    ).toEqual([]);
  });
});
