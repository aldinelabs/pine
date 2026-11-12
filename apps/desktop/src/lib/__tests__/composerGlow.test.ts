import { describe, expect, it } from "vitest";
import { composerGlowStyle } from "../composerGlow";

const TIMINGS = [
  ["spin-a", "delay-a", 9.7],
  ["spin-b", "delay-b", 14.3],
  ["drift", "delay-drift", 17.9],
  ["breathe", "delay-breathe", 6.1],
  ["pulse", "delay-pulse", 4.3],
] as const;

function seconds(value: string | undefined): number {
  expect(value).toMatch(/^-?\d+(\.\d+)?s$/);
  return Number.parseFloat(value!);
}

describe("composerGlowStyle", () => {
  it.each([0, 0.5, 0.999])(
    "jitters each period and starts at a random phase (random %s)",
    (value) => {
      const style = composerGlowStyle(() => value);
      expect(Object.keys(style)).toHaveLength(10);
      for (const [durationName, delayName, base] of TIMINGS) {
        const duration = seconds(style[`--composer-glow-${durationName}`]);
        const delay = seconds(style[`--composer-glow-${delayName}`]);
        expect(duration).toBeGreaterThanOrEqual(base * 0.85 - 0.001);
        expect(duration).toBeLessThanOrEqual(base * 1.15 + 0.001);
        expect(delay).toBeLessThanOrEqual(0);
        expect(delay).toBeGreaterThan(-duration);
      }
    },
  );

  it("differs between random sources", () => {
    expect(composerGlowStyle(() => 0.1)).not.toEqual(
      composerGlowStyle(() => 0.8),
    );
  });
});
