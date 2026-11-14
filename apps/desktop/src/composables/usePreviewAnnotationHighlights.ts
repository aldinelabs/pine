import { onScopeDispose, shallowRef, watch, type Ref } from "vue";
import { locateTextAnchor } from "@/lib/annotationAnchors";
import { rangeContainsPoint } from "@/lib/transcriptSelection";
import type {
  AnnotationLines,
  AnnotationSurface,
  PreviewDisplayMode,
} from "@/components/project/file-preview/previewRenderer";
import type {
  PreviewAnnotation,
  TextAnnotationAnchor,
} from "@/stores/previewAnnotations";

export const ANNOTATION_HIGHLIGHT = "pine-annotation";
export const ACTIVE_ANNOTATION_HIGHLIGHT = "pine-annotation-active";

interface OwnRanges {
  normal: Range[];
  active: Range[];
}

/** Each preview's ranges, per window: a frame has its own highlight registry. */
const registries = new Map<Window, Map<symbol, OwnRanges>>();

type HighlightWindow = Window & {
  Highlight?: typeof Highlight;
  CSS?: typeof CSS;
};

function publish(view: Window): void {
  const scope = view as HighlightWindow;
  const HighlightClass = scope.Highlight;
  const highlights = scope.CSS?.highlights;
  if (!HighlightClass || !highlights) return;
  const all = [...(registries.get(view)?.values() ?? [])];
  highlights.set(
    ANNOTATION_HIGHLIGHT,
    new HighlightClass(...all.flatMap((ranges) => ranges.normal)),
  );
  highlights.set(
    ACTIVE_ANNOTATION_HIGHLIGHT,
    new HighlightClass(...all.flatMap((ranges) => ranges.active)),
  );
}

function setRanges(view: Window, key: symbol, ranges?: OwnRanges): void {
  let registry = registries.get(view);
  if (!ranges) {
    if (!registry?.delete(key)) return;
    if (!registry.size) registries.delete(view);
  } else {
    if (!registry) registries.set(view, (registry = new Map()));
    registry.set(key, ranges);
  }
  try {
    publish(view);
  } catch {
    // A frame that has gone away keeps no highlights.
  }
}

export interface AnnotationPlacement {
  anchor: TextAnnotationAnchor;
  lines?: AnnotationLines;
}

function sameSurfaces(
  a: readonly AnnotationSurface[],
  b: readonly AnnotationSurface[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (surface, index) =>
        surface.root === b[index]?.root &&
        surface.excluded === b[index]?.excluded &&
        surface.segment === b[index]?.segment,
    )
  );
}

/** The surface a node is in, if any. */
export function surfaceOf(
  surfaces: readonly AnnotationSurface[],
  node: Node,
): AnnotationSurface | undefined {
  return surfaces.find((surface) => surface.root.contains(node));
}

/**
 * Marks the commented passages of a preview in amber, finds them again after
 * the content re-renders or the file changes, and reports which comment a
 * click lands on. The marks are CSS highlights, so the renderer's markup
 * (and a page's frame) stays untouched. A preview may have several surfaces
 * (pages, slides, chapters); a comment is only looked for in its own, and a
 * surface that is not rendered leaves its comments as they are.
 */
export function usePreviewAnnotationHighlights(options: {
  /** Read on every pass: renderers replace their text's roots as they re-render. */
  surfaces: () => readonly AnnotationSurface[];
  /** Element around the renderer; its mutations mean the text may have moved. */
  host: Ref<HTMLElement | null>;
  annotations: Ref<readonly PreviewAnnotation[]>;
  mode: Ref<PreviewDisplayMode>;
  activeId: Ref<string | undefined>;
  /** A passage being commented on, shown as active until it is saved. */
  draft: Ref<Range | undefined>;
  enabled: Ref<boolean>;
  lines: (range: Range) => AnnotationLines | undefined;
  /** The passage was found, at new offsets or after having been lost. */
  onPlaced: (id: string, placement: AnnotationPlacement) => void;
  /** The passage is no longer in the text. */
  onLost: (id: string) => void;
  onHit: (id: string) => void;
}) {
  const key = Symbol("preview-annotations");
  /** The surfaces as of the last pass. */
  const surfaces = shallowRef<readonly AnnotationSurface[]>([]);
  /** Documents the surfaces live in, listened to for clicks. */
  const documents = shallowRef<readonly Document[]>([]);
  let views = new Set<Window>();
  let placed: { id: string; range: Range }[] = [];
  let frame = 0;

  function clearViews(keep: ReadonlySet<Window> = new Set()): void {
    for (const view of views) if (!keep.has(view)) setRanges(view, key);
    views = new Set([...views].filter((view) => keep.has(view)));
  }

  function place(): void {
    frame = 0;
    const next = options.enabled.value ? options.surfaces() : [];
    if (!sameSurfaces(next, surfaces.value)) surfaces.value = next;
    placed = [];
    const nextDocuments = [
      ...new Set(next.map((surface) => surface.root.ownerDocument)),
    ];
    if (
      nextDocuments.length !== documents.value.length ||
      nextDocuments.some(
        (document, index) => document !== documents.value[index],
      )
    )
      documents.value = nextDocuments;
    for (const annotation of options.annotations.value) {
      const anchor = annotation.anchor;
      if (anchor.kind !== "text" || annotation.mode !== options.mode.value)
        continue;
      const surface = next.find(
        (candidate) => candidate.segment === anchor.segment,
      );
      // Nothing rendered there yet: keep the comment as it is.
      if (!surface?.root.textContent?.trim()) continue;
      const found = locateTextAnchor(surface.root, anchor, surface.excluded);
      if (!found) {
        if (!annotation.orphaned) options.onLost(annotation.id);
        continue;
      }
      placed.push({ id: annotation.id, range: found.range });
      if (
        annotation.orphaned ||
        found.anchor.start !== anchor.start ||
        found.anchor.end !== anchor.end
      )
        options.onPlaced(annotation.id, {
          anchor: {
            ...found.anchor,
            kind: "text",
            ...(anchor.segment !== undefined
              ? { segment: anchor.segment }
              : {}),
          },
          lines: options.lines(found.range) ?? annotation.lines,
        });
    }
    const activeId = options.activeId.value;
    const draft = options.draft.value;
    const byView = new Map<Window, OwnRanges>();
    const rangesOf = (range: Range): OwnRanges | undefined => {
      const view = range.startContainer.ownerDocument?.defaultView;
      if (!view) return undefined;
      let ranges = byView.get(view);
      if (!ranges) byView.set(view, (ranges = { normal: [], active: [] }));
      return ranges;
    };
    for (const document of nextDocuments)
      if (document.defaultView && !byView.has(document.defaultView))
        byView.set(document.defaultView, { normal: [], active: [] });
    for (const item of placed)
      rangesOf(item.range)?.[item.id === activeId ? "active" : "normal"].push(
        item.range,
      );
    if (draft && surfaceOf(next, draft.commonAncestorContainer))
      rangesOf(draft)?.active.push(draft);
    clearViews(new Set(byView.keys()));
    for (const [view, ranges] of byView) {
      views.add(view);
      setRanges(view, key, ranges);
    }
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(place);
  }

  let observer: MutationObserver | undefined;
  watch(
    [options.host, options.enabled],
    ([host, enabled]) => {
      observer?.disconnect();
      observer = undefined;
      if (!host || !enabled) return;
      observer = new MutationObserver(schedule);
      observer.observe(host, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    { immediate: true },
  );
  watch(
    [
      options.annotations,
      options.mode,
      options.activeId,
      options.draft,
      options.enabled,
    ],
    schedule,
    { deep: true, immediate: true },
  );

  function hit(event: MouseEvent): string | undefined {
    return placed.find((item) =>
      rangeContainsPoint(item.range, event.clientX, event.clientY),
    )?.id;
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    // A frame's nodes are not instances of this window's Node.
    const surface = target ? surfaceOf(surfaces.value, target) : undefined;
    if (
      !surface ||
      event.button !== 0 ||
      !surface.root.ownerDocument.getSelection()?.isCollapsed
    )
      return;
    const id = hit(event);
    if (id) options.onHit(id);
  }

  let pointerFrame = 0;
  function handlePointerMove(event: MouseEvent): void {
    if (pointerFrame || !placed.length) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const target = event.target as Node | null;
      const surface = target ? surfaceOf(surfaces.value, target) : undefined;
      if (surface) surface.root.style.cursor = hit(event) ? "pointer" : "";
    });
  }

  watch(documents, (next, _previous, onCleanup) => {
    for (const document of next) {
      document.addEventListener("click", handleClick);
      document.addEventListener("mousemove", handlePointerMove);
    }
    onCleanup(() => {
      for (const document of next) {
        document.removeEventListener("click", handleClick);
        document.removeEventListener("mousemove", handlePointerMove);
      }
    });
  });

  /** The passage of a comment, where it is shown now. */
  function rangeOf(id: string): Range | undefined {
    return placed.find((item) => item.id === id)?.range;
  }

  onScopeDispose(() => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    documents.value = [];
    clearViews();
  });

  return { surfaces, refresh: schedule, rangeOf };
}

/**
 * A rectangle in a frame's document, in the coordinates of the top window,
 * through every frame's position and scale on the way up.
 */
export function rectInTopWindow(rect: DOMRect, document: Document): DOMRect {
  let result = rect;
  let frame = document.defaultView?.frameElement as HTMLElement | null;
  while (frame) {
    const box = frame.getBoundingClientRect();
    const scaleX = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
    const scaleY = frame.offsetHeight ? box.height / frame.offsetHeight : 1;
    result = new DOMRect(
      box.left + (frame.clientLeft + result.left) * scaleX,
      box.top + (frame.clientTop + result.top) * scaleY,
      result.width * scaleX,
      result.height * scaleY,
    );
    frame = frame.ownerDocument.defaultView?.frameElement as HTMLElement | null;
  }
  return result;
}
