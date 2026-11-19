import { describe, expect, it } from "vitest";
import { levelHeight, waveformBars } from "../liveContextWaveform";

describe("levelHeight", () => {
  it("maps silence to nothing and full scale to the top", () => {
    expect(levelHeight(0)).toBe(0);
    expect(levelHeight(Number.NaN)).toBe(0);
    expect(levelHeight(0.0001)).toBe(0);
    expect(levelHeight(1)).toBe(1);
    expect(levelHeight(4)).toBe(1);
  });

  it("gives quiet speech a visible bar", () => {
    // About -34 dBFS, a soft voice at a laptop microphone.
    expect(levelHeight(0.02)).toBeGreaterThan(0.3);
    expect(levelHeight(0.02)).toBeLessThan(levelHeight(0.2));
  });
});

describe("waveformBars", () => {
  it("puts each reading in its time slice, newest on the right, loudest wins", () => {
    const { newest, bars } = waveformBars(
      [
        { at: 100, levels: { mic: { rms: 1, peak: 1 } } },
        { at: 3_500, levels: { system: { rms: 1, peak: 1 } } },
        { at: 3_900, levels: { mic: { rms: 0.01, peak: 0.1 } } },
        { at: 3_950, levels: { mic: { rms: 1, peak: 1 } } },
      ],
      3_999,
      4,
      1_000,
    );
    expect(newest).toBe(3_000);
    expect([...bars.mic]).toEqual([1, 0, 0, 1]);
    expect([...bars.system]).toEqual([0, 0, 0, 1]);
  });

  it("keeps a finished bar's height while time moves on", () => {
    const samples = [
      { at: 1_100, levels: { mic: { rms: 1, peak: 1 } } },
      { at: 1_900, levels: { mic: { rms: 0.01, peak: 0.1 } } },
    ];
    const early = waveformBars(samples, 2_100, 3, 1_000).bars.mic;
    const later = waveformBars(samples, 2_900, 3, 1_000).bars.mic;
    expect([...early]).toEqual([...later]);
    expect(early[1]).toBe(1);
  });

  it("leaves out readings outside the bars", () => {
    const { bars } = waveformBars(
      [
        { at: 1_999, levels: { mic: { rms: 1, peak: 1 } } },
        { at: 5_000, levels: { mic: { rms: 1, peak: 1 } } },
      ],
      4_000,
      2,
      1_000,
    );
    expect([...bars.mic]).toEqual([0, 0]);
  });
});
