import type { IntelligentUiProps } from "@/shared/intelligentUi";

export type IuiColor = NonNullable<IntelligentUiProps<"Badge">["color"]>;
export type IuiTone = NonNullable<IntelligentUiProps<"Text">["tone"]>;

/** Foreground for Badge and Icon colours, readable in light and dark. */
export const COLOR_TEXT: Record<IuiColor, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-warning",
  danger: "text-destructive",
  purple: "text-violet-600 dark:text-violet-400",
  pink: "text-pink-600 dark:text-pink-400",
};

/** A tinted fill with its foreground, for Badge colours. */
export const COLOR_FILL: Record<IuiColor, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/10 text-info dark:bg-info/20",
  success:
    "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-400",
  warning: "bg-warning/10 text-warning dark:bg-warning/20",
  danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  purple:
    "bg-violet-600/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-400",
  pink: "bg-pink-600/10 text-pink-700 dark:bg-pink-400/15 dark:text-pink-400",
};

/** Text tones shared by Text and Caption. */
export const TONE_TEXT: Record<IuiTone, string> = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-warning",
  danger: "text-destructive",
};

export function colorText(color: unknown): string | undefined {
  return typeof color === "string" && color in COLOR_TEXT
    ? COLOR_TEXT[color as IuiColor]
    : undefined;
}
