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

const PROJECT_COLOR_THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

const OKLCH_PATTERN =
  /^oklch\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?))?\s*\)$/i;

export const PROJECT_COLOR_THEME_OPTIONS: readonly {
  swatch: string;
  value: ProjectColorTheme;
}[] = PROJECT_COLOR_THEME_VALUES.map((value) => ({
  swatch: `oklch(0.58 0.12 ${PROJECT_COLOR_THEME_HUES[value]})`,
  value,
}));

function getHueShift(value: ProjectColorTheme): number {
  const difference =
    PROJECT_COLOR_THEME_HUES[value] - PROJECT_COLOR_THEME_HUES.olive;

  return ((((difference + 180) % 360) + 360) % 360) - 180;
}

function formatChannel(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** Rotates interface token hues; status and chart colors keep Pine defaults. */
export function applyProjectColorTheme(
  root: HTMLElement,
  value: ProjectColorTheme,
): void {
  if (value === "olive") {
    for (const token of PROJECT_COLOR_THEME_TOKENS) {
      root.style.removeProperty(`--${token}`);
    }
    return;
  }

  const hueShift = getHueShift(value);
  const oliveColors = getComputedStyle(root);

  for (const token of PROJECT_COLOR_THEME_TOKENS) {
    const source = oliveColors.getPropertyValue(`--pine-olive-${token}`).trim();
    const match = OKLCH_PATTERN.exec(source);

    if (!match) {
      root.style.removeProperty(`--${token}`);
      continue;
    }

    const [, lightnessValue, lightnessUnit, chromaValue, hueValue, alpha] =
      match;
    const lightness =
      Number(lightnessValue) / (lightnessUnit === "%" ? 100 : 1);
    const chroma = Number(chromaValue);
    const hue = (((Number(hueValue) + hueShift) % 360) + 360) % 360;
    const color = `oklch(${formatChannel(lightness)} ${formatChannel(chroma)} ${formatChannel(hue)}${alpha ? ` / ${alpha}` : ""})`;

    root.style.setProperty(`--${token}`, color);
  }
}
