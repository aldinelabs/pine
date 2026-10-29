import { inject, provide, type InjectionKey } from "vue";

const surfaceDepthKey: InjectionKey<number> = Symbol("iui-surface-depth");

export type IuiSurface = "raised" | "inset";

/**
 * Where a card or tile sits. The transcript and a card share one background
 * in light mode, so a surface on the transcript is raised (the muted fill of
 * shadcn's muted item); inside a raised surface it is inset (the page
 * background), and deeper levels alternate. Children see the next level.
 */
export function useSurface(): IuiSurface {
  const depth = inject(surfaceDepthKey, 0);
  provide(surfaceDepthKey, depth + 1);
  return depth % 2 === 0 ? "raised" : "inset";
}

/** Fill for a native Card on that surface; it keeps its own ring and radius. */
export const CARD_SURFACE_CLASS: Record<IuiSurface, string> = {
  raised: "bg-muted/50 shadow-none",
  inset: "bg-background shadow-none",
};
