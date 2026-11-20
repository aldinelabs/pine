import type { PineUserColor } from "@/shared/users";

/**
 * Each user colour as a soft tile behind the avatar and a solid swatch for
 * the colour picker. Full class names so Tailwind keeps them.
 */
export const USER_COLOR_CLASSES: Record<
  PineUserColor,
  { tile: string; swatch: string }
> = {
  green: {
    tile: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    swatch: "bg-emerald-500",
  },
  blue: {
    tile: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    swatch: "bg-sky-500",
  },
  violet: {
    tile: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    swatch: "bg-violet-500",
  },
  rose: {
    tile: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    swatch: "bg-rose-500",
  },
  amber: {
    tile: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    swatch: "bg-amber-500",
  },
  teal: {
    tile: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
    swatch: "bg-teal-500",
  },
  orange: {
    tile: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    swatch: "bg-orange-500",
  },
  slate: {
    tile: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
    swatch: "bg-slate-500",
  },
};
