import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_COLOR_THEMES } from "@/shared/projects";
import { projectColorThemeHueShift } from "../projectColorThemes";

const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

describe("project color themes", () => {
  it.each(PROJECT_COLOR_THEMES.filter((theme) => theme !== "olive"))(
    "turns %s by its hue shift in CSS",
    (theme) => {
      const rule = new RegExp(
        String.raw`:root\[data-project-color-theme="${theme}"\] \{\s*--pine-hue-shift: ([-\d.]+);`,
      ).exec(css);
      expect(Number(rule?.[1])).toBe(projectColorThemeHueShift(theme));
    },
  );

  it("keeps blue's shift in (-180, 180]", () => {
    expect(projectColorThemeHueShift("blue")).toBe(147.6);
    expect(projectColorThemeHueShift("violet")).toBe(-174.4);
    expect(projectColorThemeHueShift("olive")).toBe(0);
  });

  it("rotates every interface token but leaves status colors alone", () => {
    const rotated =
      /:root\[data-project-color-theme\]:not\(\[data-project-color-theme="olive"\]\) \{([^}]*)\}/.exec(
        css,
      )?.[1];
    for (const token of ["background", "primary", "sidebar-ring", "border"])
      expect(rotated).toContain(
        `--${token}: oklch(\n    from var(--pine-olive-${token})`,
      );
    expect(rotated).not.toContain("--destructive");
    expect(rotated).not.toContain("--chart-1");
  });
});
