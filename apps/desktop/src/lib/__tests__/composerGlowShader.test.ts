import { describe, expect, it } from "vitest";
import { COMPOSER_GLOW_FRAGMENT } from "../composerGlowShader";

describe("composer glow fragment shader", () => {
  const branch = COMPOSER_GLOW_FRAGMENT.slice(
    COMPOSER_GLOW_FRAGMENT.indexOf("if (uDark > 0.5)"),
  );
  const [dark, light] = branch.split("} else {");

  it("composites the light theme by coverage, with the tint itself", () => {
    // Lifting the tint to its brightest channel made Neutral white on white
    // and olive a near-invisible yellow.
    expect(light).toBeDefined();
    expect(light).toContain("gl_FragColor = vec4(tint * alpha, alpha);");
    expect(light).not.toContain("1.0 - exp(-light)");
    expect(light).not.toContain("rim * spot");
  });

  it("keeps the additive white-hot core for the dark theme", () => {
    expect(dark).toContain("if (uDark > 0.5)");
    expect(dark).toContain("rim * spot");
  });
});
