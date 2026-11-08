import { useEventListener } from "@vueuse/core";
import { onScopeDispose, watch, type Ref } from "vue";
import {
  locatePassage,
  rangeContainsPoint,
  rangeOffsets,
  rangesOverlap,
  type TranscriptSelection,
} from "@/lib/transcriptSelection";
import type { SideChatHighlight } from "@/stores/sideChat";

const HIGHLIGHT = "pine-side-chat";
const ACTIVE_HIGHLIGHT = "pine-side-chat-active";

interface PlacedHighlight extends SideChatHighlight {
  range: Range;
  root: HTMLElement;
}

/** Each transcript's ranges; the registry shows them all under two names. */
const ownRanges = new Map<symbol, { normal: Range[]; active: Range[] }>();

function supportsHighlights(): boolean {
  return typeof Highlight !== "undefined" && "highlights" in CSS;
}

function publish(): void {
  if (!supportsHighlights()) return;
  const all = [...ownRanges.values()];
  CSS.highlights.set(HIGHLIGHT, new Highlight(...all.flatMap((r) => r.normal)));
  CSS.highlights.set(
    ACTIVE_HIGHLIGHT,
    new Highlight(...all.flatMap((r) => r.active)),
  );
}

/**
 * Marks the passages that saved follow-ups ask about in purple and opens a
 * follow-up when its passage is clicked. The marks are CSS highlights over
 * the rendered text, so the transcript's markup stays untouched.
 */
export function useSideChatHighlights(options: {
  container: Ref<HTMLElement | null>;
  enabled: Ref<boolean>;
  highlights: Ref<readonly SideChatHighlight[]>;
  activeSideChatId: Ref<string | undefined>;
  /** The entry id a rendered message id stands for. */
  entryIdOf: (messageId: string) => string;
  open: (sideChatId: string) => void;
}) {
  const key = Symbol("side-chat-highlights");
  let placed: PlacedHighlight[] = [];
  let frame = 0;

  function place(): void {
    frame = 0;
    const container = options.container.value;
    placed = [];
    if (container && options.enabled.value && options.highlights.value.length)
      for (const root of container.querySelectorAll<HTMLElement>(
        "[data-message-id]",
      )) {
        const entryId = options.entryIdOf(root.dataset.messageId ?? "");
        for (const highlight of options.highlights.value) {
          if (highlight.anchor.messageId !== entryId) continue;
          const range = locatePassage(root, highlight.anchor);
          if (range) placed.push({ ...highlight, range, root });
        }
      }
    const previous = ownRanges.get(key);
    // Nothing placed before or now: the shared registry is unchanged, so skip
    // rebuilding it (this runs on every streaming frame of a transcript).
    if (
      placed.length === 0 &&
      (!previous ||
        (previous.normal.length === 0 && previous.active.length === 0))
    )
      return;
    const activeId = options.activeSideChatId.value;
    ownRanges.set(key, {
      normal: placed
        .filter((item) => item.sideChatId !== activeId)
        .map((item) => item.range),
      active: placed
        .filter((item) => item.sideChatId === activeId)
        .map((item) => item.range),
    });
    publish();
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(place);
  }

  let observer: MutationObserver | undefined;
  // Transcript mutations only move passages while there are some to place;
  // otherwise every streamed token would queue a placement pass.
  const observing = () =>
    options.enabled.value && options.highlights.value.length > 0;
  watch(
    [options.container, observing],
    ([container, active], previous) => {
      const containerChanged = !previous || previous[0] !== container;
      if (!containerChanged && Boolean(observer) === active) return;
      observer?.disconnect();
      observer = undefined;
      if (!container) return;
      if (active) {
        observer = new MutationObserver(schedule);
        observer.observe(container, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
      if (containerChanged) schedule();
    },
    { immediate: true },
  );
  watch(
    [options.highlights, options.activeSideChatId, options.enabled],
    schedule,
    { deep: true },
  );

  function hit(event: MouseEvent): PlacedHighlight | undefined {
    return placed.find((item) =>
      rangeContainsPoint(item.range, event.clientX, event.clientY),
    );
  }

  useEventListener(options.container, "click", (event: MouseEvent) => {
    if (event.button !== 0 || !window.getSelection()?.isCollapsed) return;
    const target = hit(event);
    if (target) options.open(target.sideChatId);
  });
  let pointerFrame = 0;
  useEventListener(options.container, "mousemove", (event: MouseEvent) => {
    if (pointerFrame || !placed.length) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      const container = options.container.value;
      if (container) container.style.cursor = hit(event) ? "pointer" : "";
    });
  });

  /** Whether a selection overlaps a passage that already has a follow-up. */
  function overlaps(selection: TranscriptSelection): boolean {
    return placed.some((item) => {
      if (item.root !== selection.root) return false;
      const offsets = rangeOffsets(item.root, item.range);
      return offsets ? rangesOverlap(offsets, selection) : false;
    });
  }

  onScopeDispose(() => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    ownRanges.delete(key);
    publish();
  });

  return { overlaps, refresh: schedule };
}
