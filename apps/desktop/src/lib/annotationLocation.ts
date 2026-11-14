import type {
  AnnotationCells,
  AnnotationPlace,
  AnnotationShape,
  AnnotationTarget,
} from "@/components/project/file-preview/previewRenderer";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A spreadsheet column's letters for its 0-based index: 0 → A, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26))
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  return name;
}

/** Cells in A1 notation: "B2" or "B2:D5", without the sheet. */
export function cellsRange(cells: AnnotationCells): string {
  const start = `${columnName(cells.startColumn)}${cells.startRow + 1}`;
  const end = `${columnName(cells.endColumn)}${cells.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

/** A moment in a recording: "0:07", "12:30" or "1:02:03". */
export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/** A stretch of a recording, "0:12–0:30", or one moment. */
export function formatTimeSpan(start: number, end: number): string {
  const from = formatTimestamp(start);
  const to = formatTimestamp(end);
  return from === to ? from : `${from}–${to}`;
}

export function placeLabel(place: AnnotationPlace, t: Translate): string {
  switch (place.kind) {
    case "page":
      return t("project.preview.annotations.page", { number: place.number });
    case "slide":
      return t("project.preview.annotations.slide", { number: place.number });
    case "chapter":
      return place.title;
    case "sheet":
      return place.name;
  }
}

/**
 * Where a comment is besides its source lines: page, slide, chapter, sheet
 * and cells, or time span. Sent with the comment and shown next to it.
 */
export function annotationPosition(
  annotation: Pick<PreviewAnnotation, "anchor" | "place">,
  t: Translate,
): string | undefined {
  const parts: string[] = [];
  if (annotation.place) parts.push(placeLabel(annotation.place, t));
  const { anchor } = annotation;
  if (anchor.kind === "cells") parts.push(cellsRange(anchor.cells));
  if (anchor.kind === "time")
    parts.push(formatTimeSpan(anchor.start, anchor.end));
  if (anchor.kind === "region")
    parts.push(t("project.preview.annotations.area"));
  return parts.length ? parts.join(" · ") : undefined;
}

/** The line or lines of a comment, then where else it is. */
export function annotationLocation(
  annotation: Pick<PreviewAnnotation, "anchor" | "place" | "lines">,
  t: Translate,
): string | undefined {
  const lines = annotation.lines;
  const parts = [
    lines
      ? lines.startLine === lines.endLine
        ? t("project.preview.annotations.line", { line: lines.startLine })
        : t("project.preview.annotations.lines", {
            start: lines.startLine,
            end: lines.endLine,
          })
      : undefined,
    annotationPosition(annotation, t),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * An area in words, for the model: in the content's pixels when its size is
 * known, else in percent of the box it was drawn on.
 */
export function regionText(
  region: Extract<AnnotationShape, { kind: "region" }>,
  size: AnnotationTarget["size"],
  t: Translate,
): string {
  if (size?.width && size.height)
    return t("project.preview.annotations.regionPixels", {
      x: Math.round(region.x * size.width),
      y: Math.round(region.y * size.height),
      width: Math.max(1, Math.round(region.width * size.width)),
      height: Math.max(1, Math.round(region.height * size.height)),
    });
  const percent = (value: number) => Math.round(value * 100);
  return t("project.preview.annotations.regionPercent", {
    x: percent(region.x),
    y: percent(region.y),
    width: Math.max(1, percent(region.width)),
    height: Math.max(1, percent(region.height)),
  });
}

/** Whether two places are the same page, slide, chapter or sheet. */
export function samePlace(
  a: AnnotationPlace | undefined,
  b: AnnotationPlace | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
