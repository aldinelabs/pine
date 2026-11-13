import { describe, expect, it } from "vitest";
import { COMPOSER_GLOW_FRAGMENT } from "../composerGlowShader";

describe("composer glow fragment shader", () => {
  const branch = COMPOSER_GLOW_FRAGMENT.slice(
    COMPOSER_GLOW_FRAGMENT.indexOf("if (uDark > 0.5)"),
  );
  const [dark, light] = branch.split("} else {");

  it("draws no rim line, only light that falls off from the edge", () => {
    // A crisp rim read as a border drawn round the text box.
    expect(COMPOSER_GLOW_FRAGMENT).not.toMatch(/\brim\b/);
    expect(COMPOSER_GLOW_FRAGMENT).toContain("float falloff");
  });

  it("keeps the light theme's haze from reading as a drop shadow", () => {
    // Mid-lightness tints laid over a white page by coverage darken it;
    // coloured tints use the lighter haze and the coverage is capped.
    expect(light).toBeDefined();
    expect(light).toContain("mix(grey, haze, uHazeOn)");
    expect(light).toMatch(/float alpha = cap \*/);
    expect(light).not.toContain("1.0 - exp(-light)");
  });

  it("tone-maps additive light in the dark theme", () => {
    expect(dark).toContain("vec3 col = 1.0 - exp(-light)");
  });

  it("moves the swells clockwise with noise only on reach and brightness", () => {
    expect(COMPOSER_GLOW_FRAGMENT).toContain("uniform float uHead;");
    expect(COMPOSER_GLOW_FRAGMENT).toContain("uniform vec4 uShape;");
    // Behind the head means counter-clockwise of it: the head leads clockwise.
    expect(COMPOSER_GLOW_FRAGMENT).toContain("fract(head - u + 0.5)");
    // The noise coordinate has no outward axis, so the edge stays smooth.
    const noise = /vec3 nc = vec3\(([^;]*);/.exec(COMPOSER_GLOW_FRAGMENT);
    expect(noise).not.toBeNull();
    expect(noise?.[1]).not.toMatch(/\b(d|outd)\b/);
  });

  it("projects onto the outline, so its corners join without seams", () => {
    expect(COMPOSER_GLOW_FRAGMENT).toContain("float outlinePosition(");
    expect(COMPOSER_GLOW_FRAGMENT).toContain("clamp(p, -e, e)");
  });

  it("keeps the light inside the room it has in each direction", () => {
    expect(COMPOSER_GLOW_FRAGMENT).toMatch(/clamp\(reach, 2\.0, max\(room/);
  });

  it("adds an animated film grain scaled by the light", () => {
    expect(COMPOSER_GLOW_FRAGMENT).toContain("floor(uTime * 24.0)");
    expect(COMPOSER_GLOW_FRAGMENT).toMatch(/energy \*= 1\.0 \+ [^;]*grain/);
  });
});
