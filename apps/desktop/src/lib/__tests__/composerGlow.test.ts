import { describe, expect, it } from "vitest";
import {
  composerGlowKeyframes,
  composerGlowOrbits,
  composerGlowOutline,
  composerGlowStyle,
} from "../composerGlow";

const TIMINGS = [
  ["breathe", "delay-breathe", 6.1],
  ["pulse", "delay-pulse", 4.3],
] as const;

function seconds(value: string | undefined): number {
  expect(value).toMatch(/^-?\d+(\.\d+)?s$/);
  return Number.parseFloat(value!);
}

/** The default composer: 736x48 text box, pill corners, 4px ring. */
const OUTLINE = composerGlowOutline({
  clientWidth: 736,
  clientHeight: 48,
  spread: 4,
  outerRadius: 28,
})!;

const FLAT = { warp: [0], wobble: [0] };

function position(keyframe: Keyframe): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
    String(keyframe.transform),
  );
  expect(match).not.toBeNull();
  return { x: Number(match![1]), y: Number(match![2]) };
}

/** Pixels travelled per unit of animation time, for each keyframe step. */
function speeds(keyframes: Keyframe[]): number[] {
  const result: number[] = [];
  for (let index = 1; index < keyframes.length; index += 1) {
    const a = position(keyframes[index - 1]);
    const b = position(keyframes[index]);
    const time = keyframes[index].offset! - keyframes[index - 1].offset!;
    if (time > 0) result.push(Math.hypot(b.x - a.x, b.y - a.y) / time);
  }
  return result;
}

describe("composerGlowStyle", () => {
  it.each([0, 0.5, 0.999])(
    "jitters each period and starts at a random phase (random %s)",
    (value) => {
      const style = composerGlowStyle(() => value);
      expect(Object.keys(style)).toHaveLength(4);
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

describe("composerGlowOrbits", () => {
  it.each([0, 0.5, 0.999])(
    "jitters lap times, phases and noise (random %s)",
    (value) => {
      const orbits = composerGlowOrbits(() => value);
      expect(orbits).toHaveLength(2);
      for (const [index, base] of [9.7, 14.3].entries()) {
        const orbit = orbits[index];
        expect(orbit.durationMs).toBeGreaterThanOrEqual(base * 850 - 1);
        expect(orbit.durationMs).toBeLessThanOrEqual(base * 1150 + 1);
        expect(orbit.delayMs).toBeLessThanOrEqual(0);
        expect(orbit.delayMs).toBeGreaterThan(-orbit.durationMs);
        for (const value of [...orbit.warp, ...orbit.wobble]) {
          expect(Math.abs(value)).toBeLessThanOrEqual(1);
        }
      }
    },
  );
});

describe("composerGlowOutline", () => {
  it("follows the middle of the ring", () => {
    expect(OUTLINE).toEqual({
      x: -2,
      y: -2,
      width: 740,
      height: 52,
      radius: 26,
    });
  });

  it("is null before the ring has a size", () => {
    expect(
      composerGlowOutline({
        clientWidth: 0,
        clientHeight: 0,
        spread: 0,
        outerRadius: 0,
      }),
    ).toBeNull();
  });
});

describe("composerGlowKeyframes", () => {
  it("closes the lap with offsets that only grow", () => {
    const keyframes = composerGlowKeyframes(OUTLINE, FLAT);
    expect(keyframes[0].offset).toBe(0);
    expect(keyframes.at(-1)!.offset).toBe(1);
    for (let index = 1; index < keyframes.length; index += 1) {
      expect(keyframes[index].offset!).toBeGreaterThanOrEqual(
        keyframes[index - 1].offset!,
      );
    }
    expect(position(keyframes.at(-1)!)).toEqual(position(keyframes[0]));
    expect(String(keyframes.at(-1)!.transform)).toContain("rotate(360deg)");
  });

  it("stays on the outline", () => {
    for (const keyframe of composerGlowKeyframes(OUTLINE, FLAT)) {
      const { x, y } = position(keyframe);
      expect(x).toBeGreaterThanOrEqual(-2.01);
      expect(x).toBeLessThanOrEqual(738.01);
      expect(y).toBeGreaterThanOrEqual(-2.01);
      expect(y).toBeLessThanOrEqual(50.01);
    }
  });

  it("travels at an even pace on a wide, short text box", () => {
    // Rotating at a constant angle spent ~96% of a lap on the long edges and
    // whipped round the ends; arc-length offsets keep the pace even.
    const pace = speeds(composerGlowKeyframes(OUTLINE, FLAT));
    const min = Math.min(...pace);
    const max = Math.max(...pace);
    // Corner chords are a touch shorter than their arcs.
    expect(max / min).toBeLessThan(1.02);
  });

  it("bends the pace only within the speed noise", () => {
    const pace = speeds(
      composerGlowKeyframes(OUTLINE, { warp: [1, -1, 0.5], wobble: [0] }),
    );
    const min = Math.min(...pace);
    const max = Math.max(...pace);
    expect(max / min).toBeGreaterThan(1.3);
    expect(max / min).toBeLessThan((1.3 / 0.7) * 1.02);
  });

  it("strays slightly across the outline", () => {
    const flat = composerGlowKeyframes(OUTLINE, FLAT);
    const wobbly = composerGlowKeyframes(OUTLINE, {
      warp: [0],
      wobble: [1, -1, 0.3, -0.6],
    });
    expect(wobbly).not.toEqual(flat);
    wobbly.forEach((keyframe, index) => {
      const a = position(keyframe);
      const b = position(flat[index]);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(1.51);
    });
  });

  it("is empty for an outline with no size", () => {
    expect(
      composerGlowKeyframes(
        { x: 0, y: 0, width: 0, height: 0, radius: 0 },
        FLAT,
      ),
    ).toEqual([]);
  });
});
