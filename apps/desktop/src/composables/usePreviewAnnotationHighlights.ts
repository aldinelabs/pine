import { useEventListener } from "@vueuse/core";
import { onScopeDispose, shallowRef, watch, type Ref } from "vue";
import { locateTextAnchor, type TextAnchor } from "@/lib/annotationAnchors";
import { rangeContainsPoint } from "@/lib/transcriptSelection";
import type {
  AnnotationLines,
  AnnotationSurface,
  PreviewDisplayMode,
} from "@/components/project/file-preview/previewRenderer";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";

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
  anchor: TextAnchor;
  lines?: AnnotationLines;
}

/**
 * Marks the commented passages of a preview in amber, finds them again after
 * the content re-renders or the file changes, and reports which comment a
 * click lands on. The marks are CSS highlights, so the renderer's markup
 * (and a page's frame) stays untouched.
 */
export function usePreviewAnnotationHighlights(options: {
  /** Read on every pass: renderers replace their text's root as they re-render. */
  surface: () => AnnotationSurface | undefined;
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
  /** The surface as of the last pass. */
  const surface = shallowRef<AnnotationSurface>();
  let view: Window | undefined;
  let placed: { id: string; range: Range }[] = [];
  let frame = 0;

  function clearView(): void {
    if (view) setRanges(view, key);
    view = undefined;
  }

  function place(): void {
    frame = 0;
    const next = options.enabled.value ? options.surface() : undefined;
    if (
      next?.root !== surface.value?.root ||
      next?.excluded !== surface.value?.excluded
    )
      surface.value = next;
    placed = [];
    const nextView = next?.root.ownerDocument.defaultView ?? undefined;
    if (view && view !== nextView) clearView();
    if (!next || !nextView) {
      clearView();
      return;
    }
    view = nextView;
    const { root, excluded } = next;
    // Nothing rendered yet: keep every comment as it is until there is text.
    if (root.textContent?.trim()) {
      for (const annotation of options.annotations.value) {
        if (annotation.mode !== options.mode.value) continue;
        const found = locateTextAnchor(root, annotation.anchor, excluded);
        if (!found) {
          if (!annotation.orphaned) options.onLost(annotation.id);
          continue;
        }
        placed.push({ id: annotation.id, range: found.range });
        if (
          annotation.orphaned ||
          found.anchor.start !== annotation.anchor.start ||
          found.anchor.end !== annotation.anchor.end
        )
          options.onPlaced(annotation.id, {
            anchor: found.anchor,
            lines: options.lines(found.range) ?? annotation.lines,
          });
      }
    }
    const activeId = options.activeId.value;
    const draft = options.draft.value;
    setRanges(view, key, {
      normal: placed
        .filter((item) => item.id !== activeId)
        .map((item) => item.range),
      active: [
        ...placed
          .filter((item) => item.id === activeId)
          .map((item) => item.range),
        ...(draft && draft.startContainer.ownerDocument === root.ownerDocument
          ? [draft]
          : []),
      ],
    });
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

  const surfaceDocument = () => surface.value?.root.ownerDocument ?? null;
  useEventListener(surfaceDocument, "click", (event: MouseEvent) => {
    const root = surface.value?.root;
    if (
      !root ||
      event.button !== 0 ||
      // A frame's nodes are not instances of this window's Node.
      !root.contains(event.target as Node | null) ||
      !root.ownerDocument.getSelection()?.isCollapsed
    )
      return;
    const id = hit(event);
    if (id) options.onHit(id);
  });
  let pointerFrame = 0;
  useEventListener(surfaceDocument, "mousemove", (event: MouseEvent) => {
    if (pointerFrame || !placed.length) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const root = surface.value?.root;
      if (root) root.style.cursor = hit(event) ? "pointer" : "";
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
    clearView();
  });

  return { surface, refresh: schedule, rangeOf };
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
