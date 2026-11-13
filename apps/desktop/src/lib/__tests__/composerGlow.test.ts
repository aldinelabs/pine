import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_GLOW_DEFAULT_TINTS,
  COMPOSER_GLOW_MAX_MARGINS,
  composerGlowFrameInterval,
  composerGlowGeometry,
  composerGlowGeometryEqual,
  composerGlowMargins,
  composerGlowPixelRatio,
  composerGlowSeed,
  findClipAncestor,
  parseHexColor,
  readComposerGlowColors,
} from "@/lib/composerGlow";

const BASE_PERIODS = [7.3, 11.9, 17.3];

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height };
}

describe("composerGlowSeed", () => {
  it.each([0, 0.999])("stays in range for random() = %s", (value) => {
    const seed = composerGlowSeed(() => value);
    expect(seed.spots).toHaveLength(3);
    seed.spots.forEach((spot, index) => {
      expect(spot.period).toBeGreaterThanOrEqual(BASE_PERIODS[index] * 0.85);
      expect(spot.period).toBeLessThanOrEqual(BASE_PERIODS[index] * 1.15);
      expect(spot.start).toBeGreaterThanOrEqual(0);
      expect(spot.start).toBeLessThan(1);
    });
    expect(seed.spots.filter((spot) => spot.direction === -1)).toHaveLength(1);
    expect(seed.timeOffset).toBeGreaterThanOrEqual(0);
    expect(seed.timeOffset).toBeLessThan(1000);
    expect(seed.noise).toHaveLength(4);
  });

  it("differs between random sources", () => {
    expect(composerGlowSeed(() => 0.2)).not.toEqual(
      composerGlowSeed(() => 0.7),
    );
  });
});

describe("composerGlowMargins", () => {
  const clip = rect(0, 0, 1000, 800);

  it("takes the most room when there is plenty", () => {
    expect(composerGlowMargins(rect(100, 300, 700, 48), clip)).toEqual(
      COMPOSER_GLOW_MAX_MARGINS,
    );
    expect(COMPOSER_GLOW_MAX_MARGINS).toEqual({
      top: 40,
      right: 40,
      bottom: 24,
      left: 40,
    });
  });

  it("uses only the room up to the clipping edge", () => {
    const margins = composerGlowMargins(rect(0, 300, 1000, 488), clip);
    expect(margins.bottom).toBe(12);
    expect(margins.left).toBe(0);
    expect(margins.right).toBe(0);
    expect(margins.top).toBe(40);
  });

  it("clamps a control outside the clip to zero", () => {
    const margins = composerGlowMargins(rect(-10, -5, 1020, 820), clip);
    expect(margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("composerGlowGeometry", () => {
  it("sizes the canvas as the box plus its margins", () => {
    const geometry = composerGlowGeometry(
      rect(100, 300, 700, 48),
      rect(0, 0, 1000, 360),
      24,
      2,
    );
    expect(geometry.margins).toEqual({
      top: 40,
      right: 40,
      bottom: 12,
      left: 40,
    });
    expect(geometry.width).toBe(780);
    expect(geometry.height).toBe(100);
    expect(geometry.ratio).toBe(1);
    expect(geometry.box).toEqual({
      x: 40,
      y: 40,
      width: 700,
      height: 48,
      radius: 24,
    });
  });

  it("clamps the radius to half the smaller side", () => {
    const geometry = composerGlowGeometry(
      rect(100, 300, 700, 30),
      rect(0, 0, 1000, 800),
      24,
      1,
    );
    expect(geometry.box.radius).toBe(15);
  });

  it("compares with a half-pixel tolerance", () => {
    const clip = rect(0, 0, 1000, 800);
    const a = composerGlowGeometry(rect(100, 300, 700, 48), clip, 24, 2);
    const b = composerGlowGeometry(rect(100, 300, 700.3, 48), clip, 24, 2);
    const c = composerGlowGeometry(rect(100, 300, 701, 48), clip, 24, 2);
    expect(composerGlowGeometryEqual(a, b)).toBe(true);
    expect(composerGlowGeometryEqual(a, c)).toBe(false);
  });
});

describe("composerGlowPixelRatio", () => {
  it.each([
    [1, 0.75],
    [2, 1],
    [3, 1],
    [1.5, 0.75],
    [Number.NaN, 0.75],
  ])("dpr %s → %s", (dpr, ratio) => {
    expect(composerGlowPixelRatio(dpr)).toBe(ratio);
  });
});

describe("composerGlowFrameInterval", () => {
  const focused = { focused: true, visible: true };
  const unfocused = { focused: false, visible: true };
  const hidden = { focused: false, visible: false };

  it("draws nothing while hidden", () => {
    expect(composerGlowFrameInterval(hidden, false, "worker")).toBeNull();
    expect(composerGlowFrameInterval(hidden, true, "main")).toBeNull();
  });

  it("draws one still frame with reduced motion", () => {
    expect(composerGlowFrameInterval(focused, true, "worker")).toBe("static");
    expect(composerGlowFrameInterval(unfocused, true, "main")).toBe("static");
  });

  it("caps the frame rate by host and focus", () => {
    expect(composerGlowFrameInterval(focused, false, "worker")).toBeCloseTo(
      1000 / 60,
    );
    expect(composerGlowFrameInterval(unfocused, false, "worker")).toBeCloseTo(
      1000 / 30,
    );
    expect(composerGlowFrameInterval(focused, false, "main")).toBeCloseTo(
      1000 / 30,
    );
    expect(composerGlowFrameInterval(unfocused, false, "main")).toBeCloseTo(
      1000 / 15,
    );
  });
});

describe("colours", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("parses hex colours", () => {
    const rgb = parseHexColor("#ff8000");
    expect(rgb?.[0]).toBe(1);
    expect(rgb?.[1]).toBeCloseTo(0.502, 3);
    expect(rgb?.[2]).toBe(0);
    expect(parseHexColor("#fff")).toEqual([1, 1, 1]);
    expect(parseHexColor("oklch(0.6 0.1 100)")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
  });

  it("falls back to the olive tints when the tokens cannot be resolved", () => {
    document.documentElement.classList.add("dark");
    const element = document.createElement("div");
    document.body.append(element);
    const colors = readComposerGlowColors(element);
    element.remove();
    expect(colors.tints).toEqual(COMPOSER_GLOW_DEFAULT_TINTS);
    expect(colors.dark).toBe(true);
  });
});

describe("findClipAncestor", () => {
  it("finds the nearest ancestor that clips", () => {
    const outer = document.createElement("div");
    outer.style.overflow = "hidden";
    const middle = document.createElement("div");
    const inner = document.createElement("div");
    middle.append(inner);
    outer.append(middle);
    document.body.append(outer);
    expect(findClipAncestor(inner)).toBe(outer);
    outer.remove();
  });

  it("falls back to the root element", () => {
    const element = document.createElement("div");
    document.body.append(element);
    expect(findClipAncestor(element)).toBe(document.documentElement);
    element.remove();
  });
});
