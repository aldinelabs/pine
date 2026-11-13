import { describe, expect, it } from "vitest";
import { COMPOSER_GLOW_FRAGMENT } from "../composerGlowShader";

describe("composer glow fragment shader", () => {
  const branch = COMPOSER_GLOW_FRAGMENT.slice(
    COMPOSER_GLOW_FRAGMENT.indexOf("if (uDark > 0.5)"),
  );
  const [dark, light] = branch.split("} else {");

  it("keeps the light theme's bloom from reading as a drop shadow", () => {
    // Mid-lightness tints laid over a white page by coverage darken it, so
    // the bloom looked like a CSS box-shadow round the text box. Only the
    // rim keeps those tints; the bloom is a capped haze of lighter tints.
    expect(light).toBeDefined();
    expect(light).toContain("uTint0 * rimW.x");
    expect(light).not.toMatch(/uTint\d \* bloomW/);
    expect(light).toContain("uHaze0 * bloomW.x");
    expect(light).toMatch(/hazeAlpha = uHazeOn \* min\([^;]*, 0\.35\)/);
    expect(light).not.toContain("1.0 - exp(-light)");
  });

  it("keeps the additive white-hot core for the dark theme", () => {
    expect(dark).toContain("if (uDark > 0.5)");
    expect(dark).toContain("rim * spot");
  });

  it("moves one comet clockwise with noise only on its width and size", () => {
    expect(COMPOSER_GLOW_FRAGMENT).not.toContain("uSpots");
    expect(COMPOSER_GLOW_FRAGMENT).not.toContain("uSpotAmp");
    expect(COMPOSER_GLOW_FRAGMENT).toContain("uniform vec2 uHead;");
    expect(COMPOSER_GLOW_FRAGMENT).toContain("uniform vec4 uComet;");
    expect(COMPOSER_GLOW_FRAGMENT).toContain("uniform float uReveal;");
    // Behind the head means counter-clockwise of it: the head leads clockwise.
    expect(COMPOSER_GLOW_FRAGMENT).toContain("fract(uHead.x - u + 0.5)");
    // The noise coordinate has no outward axis, so the edge stays smooth.
    const noise = /vec3 c = vec3\(([^;]*);/.exec(COMPOSER_GLOW_FRAGMENT);
    expect(noise).not.toBeNull();
    expect(noise?.[1]).not.toMatch(/\bd \//);
  });

  it("reaches as far as the room round the text box", () => {
    expect(COMPOSER_GLOW_FRAGMENT).not.toContain("46.0");
    expect(COMPOSER_GLOW_FRAGMENT).toMatch(/d > maxMargin \*/);
    expect(COMPOSER_GLOW_FRAGMENT).toMatch(
      /float maxMargin = max\([^;]*uMargins/,
    );
  });
});
