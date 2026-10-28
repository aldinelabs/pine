import { computed, inject, type ComputedRef } from "vue";
import { previewToolbarKey } from "./previewRenderer";

/**
 * The preview's top bar for a renderer to teleport its controls into, or
 * null where there is none (the compact workbench card).
 */
export function usePreviewToolbar(
  compact: () => boolean | undefined,
): ComputedRef<HTMLElement | null> {
  const toolbar = inject(previewToolbarKey, undefined);
  return computed(() => (compact() ? null : (toolbar?.value ?? null)));
}
