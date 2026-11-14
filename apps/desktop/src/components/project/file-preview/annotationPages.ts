import type {
  AnnotationRevealRequest,
  AnnotationTarget,
} from "./previewRenderer";

/** The segment naming a 1-based page, stable across renders. */
export function pageSegment(page: number): string {
  return `page:${page}`;
}

/** An area target for a page: its box, segment and place. */
export function pageTarget(
  element: Element,
  page: number,
  size?: AnnotationTarget["size"],
): AnnotationTarget {
  return {
    element,
    segment: pageSegment(page),
    place: { kind: "page", number: page },
    ...(size ? { size } : {}),
  };
}

/** The 1-based page a comment is on, from its place or its segment. */
export function requestedPage(
  request: AnnotationRevealRequest,
): number | undefined {
  if (request.place?.kind === "page") return request.place.number;
  const match = /^page:(\d+)$/.exec(request.segment ?? "");
  return match ? Number(match[1]) : undefined;
}
