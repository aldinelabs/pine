import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSER_GLOW_COMPANION,
  COMPOSER_GLOW_ENTER_MS,
  COMPOSER_GLOW_FADE_OUT_MS,
  COMPOSER_GLOW_LAP_SECONDS,
  COMPOSER_GLOW_MAX_STEP_MS,
  advanceComposerGlowMotion,
  composerGlowEntryPoint,
  composerGlowFrame,
  composerGlowPerimeter,
  composerGlowStartMotion,
  composerGlowWave,
  COMPOSER_GLOW_DEFAULT_HAZE,
  COMPOSER_GLOW_DEFAULT_TINTS,
  composerGlowTintsAreGrey,
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

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height };
}

describe("composerGlowSeed", () => {
  it.each([0, 0.999])("stays in range for random() = %s", (value) => {
    const seed = composerGlowSeed(() => value);
    expect(seed.lapSeconds).toBeGreaterThanOrEqual(
      COMPOSER_GLOW_LAP_SECONDS * 0.92 - 1e-9,
    );
    expect(seed.lapSeconds).toBeLessThanOrEqual(
      COMPOSER_GLOW_LAP_SECONDS * 1.08 + 1e-9,
    );
    expect(seed.waves).toHaveLength(3);
    for (const phase of seed.waves) {
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
    }
    // One comet, always clockwise: nothing in the seed picks a direction.
    expect(seed).not.toHaveProperty("direction");
    expect(seed).not.toHaveProperty("spots");
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
      top: 28,
      right: 64,
      bottom: 36,
      left: 64,
    });
    // The todo and steering cards sit 32 px above the composer.
    expect(COMPOSER_GLOW_MAX_MARGINS.top).toBeLessThan(32);
  });

  it("uses only the room up to the clipping edge", () => {
    const margins = composerGlowMargins(rect(0, 300, 1000, 488), clip);
    expect(margins.bottom).toBe(12);
    expect(margins.left).toBe(0);
    expect(margins.right).toBe(0);
    expect(margins.top).toBe(28);
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
      top: 28,
      right: 64,
      bottom: 12,
      left: 64,
    });
    expect(geometry.width).toBe(828);
    expect(geometry.height).toBe(88);
    expect(geometry.ratio).toBe(1);
    expect(geometry.box).toEqual({
      x: 64,
      y: 28,
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
    expect(colors.haze).toEqual(COMPOSER_GLOW_DEFAULT_HAZE);
    expect(colors.dark).toBe(true);
  });

  it("tells grey (Neutral) tints from coloured ones", () => {
    expect(
      composerGlowTintsAreGrey([
        [0.55, 0.55, 0.55],
        [0.62, 0.62, 0.621],
      ]),
    ).toBe(true);
    expect(composerGlowTintsAreGrey(COMPOSER_GLOW_DEFAULT_TINTS)).toBe(false);
  });

  it("turns the warm tokens toward amber and the cool ones toward green", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../../index.css"),
      "utf8",
    );
    const hue = (token: string) =>
      [
        ...css.matchAll(
          new RegExp(
            `${token}: oklch\\(\\s*[\\d.]+ [\\d.]+ calc\\(([\\d.]+)`,
            "g",
          ),
        ),
      ].map((match) => Number(match[1]));
    const accent = hue("--composer-glow-color");
    expect(accent.length).toBeGreaterThan(0);
    // OKLCH hue falls toward amber/red and rises toward green/blue.
    for (const suffix of ["color", "haze"]) {
      const base = hue(`--composer-glow-${suffix}`)[0];
      expect(hue(`--composer-glow-${suffix}-warm`).length).toBeGreaterThan(0);
      expect(hue(`--composer-glow-${suffix}-cool`).length).toBeGreaterThan(0);
      for (const warm of hue(`--composer-glow-${suffix}-warm`))
        expect(warm).toBeLessThan(base);
      for (const cool of hue(`--composer-glow-${suffix}-cool`))
        expect(cool).toBeGreaterThan(base);
    }
  });

  it("orders the default tints accent, warmer (redder), cooler (greener)", () => {
    // The warm tint once turned the hue toward green, the cool one toward
    // amber: the names said the opposite of what the light showed.
    const [, warm, cool] = COMPOSER_GLOW_DEFAULT_TINTS;
    expect(warm[0]).toBeGreaterThan(warm[1]);
    expect(cool[1]).toBeGreaterThan(cool[0]);
    const [, hazeWarm, hazeCool] = COMPOSER_GLOW_DEFAULT_HAZE;
    expect(hazeWarm[0]).toBeGreaterThan(hazeWarm[1]);
    expect(hazeCool[1]).toBeGreaterThan(hazeCool[0]);
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

describe("composer glow motion", () => {
  const box = { x: 64, y: 28, width: 400, height: 100, radius: 20 };
  const seed = composerGlowSeed(() => 0.5);

  /** Advances `ms` in 16 ms steps. */
  function run(
    motion: ReturnType<typeof composerGlowStartMotion>,
    ms: number,
    present = true,
  ) {
    let next = motion;
    for (let elapsed = 0; elapsed < ms; elapsed += 16)
      next = advanceComposerGlowMotion(
        next,
        Math.min(16, ms - elapsed),
        present,
        seed,
      );
    return next;
  }

  it("starts at the midpoint of the bottom-right corner", () => {
    const quarter = 180 + (Math.PI / 2) * 20 + 30;
    expect(composerGlowEntryPoint(box)).toBeCloseTo(
      (quarter + 30 + (Math.PI / 4) * 20) / (4 * quarter),
      6,
    );
    expect(composerGlowEntryPoint(box)).toBeCloseTo(0.297, 3);
    expect(
      composerGlowEntryPoint({ x: 0, y: 0, width: 80, height: 80, radius: 0 }),
    ).toBeCloseTo(0.375, 6);
    expect(composerGlowStartMotion(box)).toEqual({
      head: composerGlowEntryPoint(box),
      reveal: 0,
      clock: 0,
    });
  });

  it("moves the head clockwise and wraps it", () => {
    let motion = { ...composerGlowStartMotion(box), reveal: 1 };
    let travelled = 0;
    for (let step = 0; step < 500; step += 1) {
      const next = advanceComposerGlowMotion(motion, 16, true, seed);
      const delta = next.head - motion.head;
      // Strictly forward, except where it wraps from 1 back to 0.
      expect(delta > 0 || (delta < -0.9 && next.head < motion.head)).toBe(true);
      travelled += delta > 0 ? delta : delta + 1;
      expect(next.head).toBeGreaterThanOrEqual(0);
      expect(next.head).toBeLessThan(1);
      motion = next;
    }
    // 8 s at one lap per lapSeconds once fully revealed.
    expect(travelled).toBeCloseTo(8 / seed.lapSeconds, 6);
  });

  it("grows in, shrinks away and turns back mid-exit", () => {
    const start = composerGlowStartMotion(box);
    const half = run(start, COMPOSER_GLOW_ENTER_MS / 2);
    expect(half.reveal).toBeCloseTo(0.5, 6);
    const full = run(start, COMPOSER_GLOW_ENTER_MS);
    expect(full.reveal).toBe(1);
    expect(run(full, 1000).reveal).toBe(1);
    const leaving = run(full, COMPOSER_GLOW_FADE_OUT_MS / 2, false);
    expect(leaving.reveal).toBeCloseTo(0.5, 6);
    expect(run(full, COMPOSER_GLOW_FADE_OUT_MS, false).reveal).toBe(0);
    const back = advanceComposerGlowMotion(leaving, 16, true, seed);
    expect(back.reveal).toBeGreaterThan(leaving.reveal);
  });

  it("caps one step, so a hidden window neither skips nor jumps", () => {
    const start = composerGlowStartMotion(box);
    const long = advanceComposerGlowMotion(start, 60_000, true, seed);
    const capped = advanceComposerGlowMotion(
      start,
      COMPOSER_GLOW_MAX_STEP_MS,
      true,
      seed,
    );
    expect(long).toEqual(capped);
    expect(long.reveal).toBeCloseTo(
      COMPOSER_GLOW_MAX_STEP_MS / COMPOSER_GLOW_ENTER_MS,
      6,
    );
    expect(advanceComposerGlowMotion(start, -5, true, seed)).toEqual(start);
  });

  it("draws a point at the start and a full comet once revealed", () => {
    const perimeter = composerGlowPerimeter(box);
    const start = composerGlowFrame(
      composerGlowStartMotion(box),
      seed,
      perimeter,
      false,
    );
    expect(start.tail).toBe(0);
    expect(start.width).toBe(0);
    expect(start.companion).toBe(0);
    expect(start.intensity).toBe(0);
    expect(start.reveal).toBe(0);

    let motion = run(composerGlowStartMotion(box), COMPOSER_GLOW_ENTER_MS);
    for (let second = 0; second < 30; second += 1) {
      motion = run(motion, 1000);
      const frame = composerGlowFrame(motion, seed, perimeter, false);
      expect(frame.reveal).toBe(1);
      expect(frame.tail).toBeGreaterThanOrEqual(90);
      expect(frame.tail).toBeLessThanOrEqual(420);
      expect(frame.width).toBeGreaterThanOrEqual(40);
      expect(frame.width).toBeLessThanOrEqual(90);
      expect(frame.intensity).toBeGreaterThanOrEqual(0.75);
      expect(frame.intensity).toBeLessThanOrEqual(1.25);
      expect(frame.level).toBeGreaterThanOrEqual(0.85);
      expect(frame.level).toBeLessThanOrEqual(1.05);
      expect(frame.companion).toBeCloseTo(COMPOSER_GLOW_COMPANION, 6);
      expect(frame.companionHead).toBeCloseTo((frame.head + 0.5) % 1, 6);
    }
  });

  it("draws a still, full comet at the entry point for reduced motion", () => {
    const perimeter = composerGlowPerimeter(box);
    const start = composerGlowStartMotion(box);
    const still = composerGlowFrame(start, seed, perimeter, true);
    expect(still.reveal).toBe(1);
    expect(still.head).toBe(composerGlowEntryPoint(box));
    expect(still.tail).toBeGreaterThan(0);
    expect(composerGlowFrame(start, seed, perimeter, true)).toEqual(still);
  });

  it("keeps the wave in 0-1", () => {
    for (let t = -50; t < 500; t += 0.37) {
      const value = composerGlowWave(t, seed.waves);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
