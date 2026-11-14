import type { FileViewerInstance } from "@file-viewer/core";
import type { FileViewerAnnotationAdapter } from ".";
import type {
  AnnotationRevealRequest,
  AnnotationSurface,
  AnnotationTarget,
} from "@/components/project/file-preview/previewRenderer";

/**
 * pdf.js (PDFViewer) lays every page out as `.pdfViewer >
 * .page[data-page-number]` up front, but draws only those near the viewport:
 * a drawn page holds a `.canvasWrapper` (the page itself, without the page's
 * transparent border) and, once its text is laid out, a `.textLayer` of
 * absolutely placed spans ending in an empty `.endOfContent` helper that
 * pdf.js moves next to the selection while the user drags.
 *
 * Zooming keeps both layers and only changes their size; the preview already
 * sees that through the pages' style, so no extra observation is needed.
 */
const PAGE = ".pdfViewer > .page[data-page-number]";

/** Helpers inside the text layer that are not part of the page's text. */
const EXCLUDED_TEXT = ".endOfContent";

/** How long a revealed page may take to draw its text before giving up. */
const REVEAL_TIMEOUT = 3000;

interface PdfPage {
  number: number;
  element: HTMLElement;
}

function pages(root: HTMLElement): PdfPage[] {
  const found: PdfPage[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(PAGE)) {
    const number = Number(element.dataset.pageNumber);
    if (Number.isInteger(number) && number > 0) found.push({ number, element });
  }
  return found;
}

function textLayer(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(":scope > .textLayer");
}

function canvasBox(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(":scope > .canvasWrapper");
}

function surfaces(root: HTMLElement): AnnotationSurface[] {
  const found: AnnotationSurface[] = [];
  for (const { number, element } of pages(root)) {
    const layer = textLayer(element);
    if (!layer) continue;
    found.push({
      root: layer,
      excluded: EXCLUDED_TEXT,
      segment: `page:${number}`,
      place: { kind: "page", number },
    });
  }
  return found;
}

/**
 * The page's size in PDF points, as shown (rotation included): pdf.js sizes
 * pages at `--scale-factor` CSS pixels per point.
 */
function pointSize(
  page: HTMLElement,
  box: HTMLElement,
): { width: number; height: number } | undefined {
  const view = page.ownerDocument.defaultView;
  const scale = Number.parseFloat(
    view?.getComputedStyle(page).getPropertyValue("--scale-factor") ?? "",
  );
  if (!(scale > 0) || !(box.offsetWidth > 0) || !(box.offsetHeight > 0))
    return undefined;
  return {
    width: Math.round(box.offsetWidth / scale),
    height: Math.round(box.offsetHeight / scale),
  };
}

function targets(root: HTMLElement): AnnotationTarget[] {
  const found: AnnotationTarget[] = [];
  for (const { number, element } of pages(root)) {
    const box = canvasBox(element);
    if (!box) continue;
    found.push({
      element: box,
      segment: `page:${number}`,
      place: { kind: "page", number },
      size: pointSize(element, box),
    });
  }
  return found;
}

function pageNumber(request: AnnotationRevealRequest): number | undefined {
  if (request.place?.kind === "page") return request.place.number;
  const match = /^page:(\d+)$/.exec(request.segment ?? "");
  return match ? Number(match[1]) : undefined;
}

/** Resolves once `ready` holds for something under `root`, or after a timeout. */
function waitFor(
  root: HTMLElement,
  ready: () => boolean,
  timeout: number,
): Promise<void> {
  if (ready() || timeout <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const view = root.ownerDocument.defaultView ?? window;
    const observer = new view.MutationObserver(() => {
      if (ready()) finish();
    });
    const timer = view.setTimeout(finish, timeout);
    function finish(): void {
      observer.disconnect();
      view.clearTimeout(timer);
      resolve();
    }
    observer.observe(root, { childList: true, subtree: true });
  });
}

async function reveal(
  root: HTMLElement,
  request: AnnotationRevealRequest,
  viewer: FileViewerInstance,
): Promise<void> {
  const number = pageNumber(request);
  if (!number) return;
  const page = (): HTMLElement | undefined =>
    pages(root).find((candidate) => candidate.number === number)?.element;
  if (!page()) return;

  const view = root.ownerDocument.defaultView ?? window;
  const deadline = Date.now() + REVEAL_TIMEOUT;

  // The viewer's own page change scrolls the page in, draws it and keeps the
  // page indicator in step. It waits for frames, which a hidden window may
  // not get, so it is not waited for past the deadline.
  await Promise.race([
    viewer
      .applyViewState(
        { page: number },
        { action: "page-change", source: "api" },
      )
      .catch(() => undefined),
    new Promise((resolve) => view.setTimeout(resolve, REVEAL_TIMEOUT)),
  ]);

  // Areas need the drawn page; text needs its text layer.
  const layer = request.shape?.kind === "region" ? canvasBox : textLayer;
  await waitFor(
    root,
    () => {
      const current = page();
      return Boolean(current && layer(current));
    },
    Math.max(0, deadline - Date.now()),
  );
}

/** PDF pages: text in each page's text layer, areas on each page. */
export const pdfAnnotations: FileViewerAnnotationAdapter = {
  renderers: ["pdf"],
  capabilities: { annotate: true, annotateRegions: true },
  surfaces,
  targets,
  reveal,
};
