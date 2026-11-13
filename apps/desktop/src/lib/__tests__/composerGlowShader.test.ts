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
});
