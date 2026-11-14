import type { Component, InjectionKey, Ref, ShallowRef } from "vue";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import type { AttachmentSelection } from "@/shared/attachments";
import type {
  FileLineRange,
  FileReveal,
  ProjectFilePreview,
} from "@/shared/projectFiles";

export type PreviewDisplayMode = "code" | "rendered";
export type RenderablePreview = Exclude<
  ProjectFilePreview,
  { kind: "unsupported" }
>;

export interface PreviewRendererProps {
  preview: RenderablePreview;
  fileName: string;
  filePath: string;
  active: boolean;
  mode: PreviewDisplayMode;
  zoom: number;
  inverted: boolean;
  selectionLabel: string;
  /** Line to scroll to and lines to tint; only text renderers use it. */
  reveal?: FileReveal;
  /** Lines that changed when the file was last re-read; only source views tint them. */
  changedLines?: readonly FileLineRange[];
  /** The workbench card shows the content alone, without in-preview controls. */
  compact?: boolean;
}

export interface PreviewRendererMetadata {
  width?: number;
  height?: number;
  duration?: number;
  pageCount?: number;
  /** Rows and columns of tabular content. */
  rowCount?: number;
  columnCount?: number;
}

export type PreviewRendererEvents = {
  failed: [];
  metadataChange: [metadata: PreviewRendererMetadata];
  selectionChange: [selection: AttachmentSelection | undefined];
  zoomWheel: [event: WheelEvent];
  /** Controls a renderer can only offer once its content has loaded. */
  capabilitiesChange: [capabilities: Partial<PreviewRendererCapabilities>];
  /** The renderer changed its own zoom, in percent (fit, gestures). */
  zoomChange: [zoom: number];
  /**
   * What can be commented on moved or changed outside the renderer's DOM
   * (a frame's document, a canvas, a virtual grid); comments are placed again.
   */
  annotationsChange: [];
};

/**
 * Where in a document a comment sits, beyond source lines: shown next to the
 * comment and sent with it.
 */
export type AnnotationPlace =
  | { kind: "page"; number: number }
  | { kind: "slide"; number: number }
  | { kind: "chapter"; title: string }
  | { kind: "sheet"; name: string };

/**
 * The rendered text a renderer lets the user comment on. Comments are
 * anchored to character offsets in the text nodes under `root` (minus
 * `excluded`), so the root may live in a frame's document; its window is
 * `root.ownerDocument.defaultView`.
 */
export interface AnnotationSurface {
  root: HTMLElement;
  /** Selector for elements inside `root` whose text is skipped (gutters, toolbars). */
  excluded?: string;
  /**
   * Names one of several surfaces (a page, slide or chapter), stable across
   * renders. A comment made in it is only looked for in it again, and keeps
   * its place while that surface is not rendered.
   */
  segment?: string;
  place?: AnnotationPlace;
}

/** Inclusive, 1-based source lines. */
export interface AnnotationLines {
  startLine: number;
  endLine: number;
}

/**
 * An element the user can draw a box on to comment on that area: an image,
 * a page or a slide. Areas are kept as fractions of its box, so they follow
 * zoom and layout.
 */
export interface AnnotationTarget {
  /** In the app's own document. */
  element: Element;
  /** As for surfaces: which page or slide, stable across renders. */
  segment?: string;
  place?: AnnotationPlace;
  /** The content's own size in pixels, to describe the area in them. */
  size?: { width: number; height: number };
}

/** A rectangle of cells; rows and columns are 0-based and inclusive. */
export interface AnnotationCells {
  sheet?: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

/** Cells the user selected, with their values as tab-separated text. */
export interface AnnotationCellSelection {
  cells: AnnotationCells;
  text: string;
}

/** What a comment points at, besides text. */
export type AnnotationShape =
  | { kind: "cells"; cells: AnnotationCells }
  | {
      kind: "region";
      segment?: string;
      /** Fractions (0–1) of the target's box. */
      x: number;
      y: number;
      width: number;
      height: number;
    }
  /** Seconds into a recording. */
  | { kind: "time"; start: number; end: number };

/** What revealing a comment brings into view. */
export interface AnnotationRevealRequest {
  segment?: string;
  place?: AnnotationPlace;
  shape?: AnnotationShape;
}

export interface PreviewRendererHandle {
  readSelection?: () => AttachmentSelection | undefined;
  /** Fits the content to the preview's width; offered with `fitWidth`. */
  fitWidth?: () => void;
  /** The text comments anchor in; offered with `annotate`. */
  annotationSurface?: () => AnnotationSurface | undefined;
  /**
   * Several texts comments anchor in, one per page, slide or chapter that is
   * rendered now; offered with `annotate`. Takes precedence over
   * `annotationSurface`.
   */
  annotationSurfaces?: () => readonly AnnotationSurface[];
  /** The source lines a range of the surface covers, when the view maps to them. */
  annotationLines?: (range: Range) => AnnotationLines | undefined;
  /** What areas can be commented on, as rendered now; offered with `annotateRegions`. */
  annotationTargets?: () => readonly AnnotationTarget[];
  /** The cells selected now; offered with `annotateCells`. */
  annotationCellSelection?: () => AnnotationCellSelection | undefined;
  /**
   * Where cells are shown now, in the app window's coordinates; empty when
   * they are scrolled out or on another sheet.
   */
  annotationCellRects?: (cells: AnnotationCells) => readonly DOMRect[];
  /**
   * Brings a comment's page, slide, chapter, sheet, cells or time into view.
   * Text and areas are then scrolled to by the preview once rendered.
   */
  revealAnnotation?: (request: AnnotationRevealRequest) => void | Promise<void>;
}

/**
 * The preview's top bar. Renderers teleport their own controls (search, pages,
 * sheets, layers) into it and report `toolbar` once they have any.
 */
export const previewToolbarKey: InjectionKey<
  Readonly<ShallowRef<HTMLElement | null>>
> = Symbol("previewToolbar");

export interface PreviewRendererCapabilities {
  zoom: boolean;
  invert: boolean;
  renderToggle: boolean;
  /** Zoom bounds in percent; the preview defaults to 50–200. */
  zoomMin?: number;
  zoomMax?: number;
  /** The renderer zooms on Ctrl/⌘ + wheel and pinch itself. */
  gestureZoom?: boolean;
  /** The renderer can fit its content to the preview's width. */
  fitWidth?: boolean;
  /** The renderer placed controls in the preview's top bar. */
  toolbar?: boolean;
  /** The renderer offers `annotationSurface(s)` (once its content is shown). */
  annotate?: boolean;
  /** The renderer offers `annotationTargets`: areas can be boxed and commented on. */
  annotateRegions?: boolean;
  /** The renderer offers `annotationCellSelection` and `annotationCellRects`. */
  annotateCells?: boolean;
  /** The renderer comments on stretches of time through `previewAnnotationsKey`. */
  annotateTime?: boolean;
}

export interface PreviewRendererContext {
  preview: RenderablePreview;
  filePath: string;
  mode: PreviewDisplayMode;
}

/** A renderer owns its format-specific UI and reports only shared preview events. */
export interface PreviewRenderer {
  id: string;
  component: Component;
  /**
   * The renderer follows a new `preview` itself. Others read their content
   * once, so a change on disk remounts them.
   */
  live?: boolean;
  supports: (context: PreviewRendererContext) => boolean;
  capabilities: (
    context: PreviewRendererContext,
  ) => PreviewRendererCapabilities;
}

export function resolvePreviewRenderer(
  renderers: readonly PreviewRenderer[],
  context: PreviewRendererContext,
): PreviewRenderer | undefined {
  return renderers.find((renderer) => renderer.supports(context));
}

/**
 * Keys a mounted renderer: the same file in the same renderer, and for
 * renderers that read their content once, the same content.
 */
export function previewRendererKey(
  file: string,
  renderer: PreviewRenderer,
  preview: ProjectFilePreview,
): string {
  if (renderer.live) return `${file}:${renderer.id}`;
  const url = "url" in preview ? (preview.url ?? "") : "";
  return `${file}:${renderer.id}:${preview.modifiedAt}:${preview.size}:${url}`;
}

/**
 * A preview's comments, for renderers that show and make them in their own
 * controls, such as a media timeline. Provided around every renderer.
 */
export interface PreviewAnnotationsContext {
  /** This file's comments, in document order. */
  annotations: Readonly<Ref<readonly PreviewAnnotation[]>>;
  activeId: Readonly<Ref<string | undefined>>;
  /** Comments can be made here: a project file whose renderer allows it. */
  enabled: Readonly<Ref<boolean>>;
  /** What is being commented on now, shown as active until it is saved. */
  draft: Readonly<Ref<AnnotationShape | undefined>>;
  /** Shows a comment in the comments panel. */
  select: (id: string) => void;
  /** Opens the comment box for a new comment on `shape`, under `rect`. */
  compose: (input: AnnotationComposeRequest) => void;
}

export interface AnnotationComposeRequest {
  shape: AnnotationShape;
  /** What the comment is about, in words: cell values, a time span, an area. */
  text: string;
  place?: AnnotationPlace;
  /** Where to show the comment box, in the app window's coordinates. */
  rect: () => DOMRect;
}

export const previewAnnotationsKey: InjectionKey<PreviewAnnotationsContext> =
  Symbol("previewAnnotations");
