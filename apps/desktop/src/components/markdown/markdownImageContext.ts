import type { ComputedRef, InjectionKey } from "vue";

/** Inherited by image renderers, including those nested in lists and tables. */
export const markdownImageDocumentUrl: InjectionKey<
  ComputedRef<string | undefined>
> = Symbol("markdownImageDocumentUrl");

/** An image the enlarged Markdown image view can show. */
export interface MarkdownViewerImage {
  src: string;
  /** The image's alt text, or its file name when it has none. */
  name: string;
}

/**
 * Opens the enlarged view on the image inside `target`. Only renderers that
 * opt in (the file preview) provide it; transcript images stay inline.
 */
export const markdownImageZoom: InjectionKey<
  ComputedRef<((target: HTMLElement) => void) | undefined>
> = Symbol("markdownImageZoom");

/** The name shown for an image: its alt text, else its file name. */
export function markdownImageName(alt: string, src: string): string {
  const text = alt.trim();
  if (text) return text;
  if (/^data:/iu.test(src.trim())) return "";
  const path = src.trim().split(/[?#]/u)[0] ?? "";
  const segment = path.split(/[\\/]/u).filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
