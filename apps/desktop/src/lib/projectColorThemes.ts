import type { ProjectColorTheme } from "@/shared/projects";

const PROJECT_COLOR_THEME_HUES: Record<ProjectColorTheme, number> = {
  olive: 107.4,
  red: 25,
  rose: 350,
  orange: 45,
  green: 150,
  blue: 255,
  yellow: 90,
  violet: 293,
};

const PROJECT_COLOR_THEME_VALUES = Object.keys(
  PROJECT_COLOR_THEME_HUES,
) as ProjectColorTheme[];

export const PROJECT_COLOR_THEME_OPTIONS: readonly {
  swatch: string;
  value: ProjectColorTheme;
}[] = PROJECT_COLOR_THEME_VALUES.map((value) => ({
  swatch: `oklch(0.58 0.12 ${PROJECT_COLOR_THEME_HUES[value]})`,
  value,
}));

/**
 * How far a theme turns Pine's olive hues, in (-180, 180]. `index.css`
 * applies it as `--pine-hue-shift` for each `data-project-color-theme`.
 */
export function projectColorThemeHueShift(value: ProjectColorTheme): number {
  const difference =
    PROJECT_COLOR_THEME_HUES[value] - PROJECT_COLOR_THEME_HUES.olive;

  return Number((((((difference + 180) % 360) + 360) % 360) - 180).toFixed(3));
}
