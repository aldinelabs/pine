import type { AnnotationSurface } from "@/components/project/file-preview/previewRenderer";
import type { FileViewerAnnotationAdapter } from ".";

/**
 * Text that is never part of the document: the stylesheets the renderers
 * inject next to (and sometimes inside) their pages, and the Pages renderer's
 * page list.
 */
export const WORD_EXCLUDED = "style, script, template, noscript, .iwork-nav";

/**
 * The page boxes the renderers draw, in document order. Each is fixed by the
 * file itself, not by the window's size, so its number stays the same across
 * renders: Word (OOXML, and Word 2003 XML or OOXML saved as .doc) breaks
 * sections at the document's own page breaks, binary Word at its page break
 * markers, Hangul per section, Pages per page.
 */
const PAGES = [
  ".docx-wrapper section.docx",
  "section.msdoc-page",
  "article.hangul-page",
  "section.iwork-scene-wrap",
].join(", ");

/**
 * One page per OpenDocument presentation slide; a text document is a single
 * box, as are RTF and WordPerfect documents.
 */
const ODF_PAGES = "article.odf-page";
const SINGLE_BODIES = ["article.flyfish-rtf-paper", "article.wpd-page"];

function pageSurfaces(
  pages: readonly HTMLElement[],
  kind: "page" | "slide",
): AnnotationSurface[] {
  return pages.map((page, index) => ({
    root: page,
    excluded: WORD_EXCLUDED,
    segment: `${kind}:${index + 1}`,
    place: { kind, number: index + 1 },
  }));
}

/** Word processor documents: Word, WordPerfect, Hangul, OpenDocument, RTF, Pages. */
export const wordAnnotations: FileViewerAnnotationAdapter = {
  renderers: [
    "office-word-openxml",
    "office-word-binary",
    "office-wordperfect",
    "office-hangul",
    // OpenDocument text and presentations, and RTF.
    "open-document",
    "apple-pages",
  ],
  capabilities: { annotate: true },
  surfaces(root) {
    const pages = [...root.querySelectorAll<HTMLElement>(PAGES)];
    if (pages.length) return pageSurfaces(pages, "page");
    const slides = [...root.querySelectorAll<HTMLElement>(ODF_PAGES)];
    if (slides.length > 1) return pageSurfaces(slides, "slide");
    const body =
      slides[0] ??
      SINGLE_BODIES.map((selector) =>
        root.querySelector<HTMLElement>(selector),
      ).find(Boolean) ??
      root;
    return [{ root: body, excluded: WORD_EXCLUDED }];
  },
};
