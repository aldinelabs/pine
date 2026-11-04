import {
  PROJECT_COLOR_THEMES,
  type ProjectColorTheme,
  type ProjectColorThemeSetting,
} from "@/shared/projects";

/** Themes drawn by turning Pine's olive hues; neutral has its own tokens. */
export type HueColorTheme = Exclude<ProjectColorTheme, "neutral">;

const PROJECT_COLOR_THEME_HUES: Record<HueColorTheme, number> = {
  olive: 107.4,
  red: 25,
  rose: 350,
  orange: 45,
  green: 150,
  blue: 255,
  yellow: 90,
  violet: 293,
};

function swatch(value: ProjectColorTheme): string {
  return value === "neutral"
    ? "oklch(0.556 0 0)"
    : `oklch(0.58 0.12 ${PROJECT_COLOR_THEME_HUES[value]})`;
}

export const PROJECT_COLOR_THEME_OPTIONS: readonly {
  swatch: string;
  value: ProjectColorTheme;
}[] = PROJECT_COLOR_THEMES.map((value) => ({ swatch: swatch(value), value }));

/**
 * A project's choices: following Pine's default, shown in that theme's
 * swatch, then every palette.
 */
export function projectColorThemeSettingOptions(
  defaultColorTheme: ProjectColorTheme,
): readonly { swatch: string; value: ProjectColorThemeSetting }[] {
  return [
    { swatch: swatch(defaultColorTheme), value: "default" },
    ...PROJECT_COLOR_THEME_OPTIONS,
  ];
}

/**
 * How far a theme turns Pine's olive hues, in (-180, 180]. `index.css`
 * applies it as `--pine-hue-shift` for each `data-project-color-theme`.
 */
export function projectColorThemeHueShift(value: HueColorTheme): number {
  const difference =
    PROJECT_COLOR_THEME_HUES[value] - PROJECT_COLOR_THEME_HUES.olive;

  return Number((((((difference + 180) % 360) + 360) % 360) - 180).toFixed(3));
}
