import type { FileViewerInstance } from "@file-viewer/core";
import type {
  AnnotationCellSelection,
  AnnotationCells,
  AnnotationRevealRequest,
  AnnotationSurface,
  AnnotationTarget,
  PreviewRendererCapabilities,
} from "@/components/project/file-preview/previewRenderer";
import { pdfAnnotations } from "./pdf";
import { slideAnnotations } from "./slides";
import { spreadsheetAnnotations } from "./spreadsheet";
import { wordAnnotations } from "./word";

/**
 * How comments work in what one or more file-viewer renderers draw. Each
 * function reads the viewer's DOM under `root` (the element the viewer was
 * mounted in) as it is now; the preview calls them again whenever the DOM
 * changes or `observe` reports a change.
 */
export interface FileViewerAnnotationAdapter {
  /** The file-viewer renderer ids (`viewer.getRenderer().id`) it serves. */
  renderers: readonly string[];
  /** What it offers; reported once the document has loaded. */
  capabilities: Pick<
    PreviewRendererCapabilities,
    "annotate" | "annotateRegions" | "annotateCells"
  >;
  surfaces?: (root: HTMLElement) => readonly AnnotationSurface[];
  targets?: (root: HTMLElement) => readonly AnnotationTarget[];
  cellSelection?: (root: HTMLElement) => AnnotationCellSelection | undefined;
  cellRects?: (root: HTMLElement, cells: AnnotationCells) => readonly DOMRect[];
  /** Shows a page, slide, sheet or cells; the preview then scrolls to text or areas. */
  reveal?: (
    root: HTMLElement,
    request: AnnotationRevealRequest,
    viewer: FileViewerInstance,
  ) => void | Promise<void>;
  /**
   * Reports changes the preview cannot see in `root`'s DOM, such as a frame's
   * document or a virtual grid's scrolling. Returns a function that stops.
   */
  observe?: (root: HTMLElement, changed: () => void) => () => void;
}

const adapters: readonly FileViewerAnnotationAdapter[] = [
  wordAnnotations,
  pdfAnnotations,
  slideAnnotations,
  spreadsheetAnnotations,
];

export function fileViewerAnnotationAdapter(
  rendererId: string,
): FileViewerAnnotationAdapter | undefined {
  return adapters.find((adapter) => adapter.renderers.includes(rendererId));
}
