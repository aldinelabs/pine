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
const MESSAGE_SELECTOR = "[data-message-id]";

interface PlacedHighlight extends SideChatHighlight {
  range: Range;
  root: HTMLElement;
}

/** Each transcript's ranges; the registry shows them all under two names. */
const ownRanges = new Map<symbol, { normal: Range[]; active: Range[] }>();

function supportsHighlights(): boolean {
  return typeof Highlight !== "undefined" && "highlights" in CSS;
}

function sameRanges(previous: Range[], next: Range[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((range, index) => {
      const other = next[index];
      return (
        other !== undefined &&
        range.startContainer === other.startContainer &&
        range.startOffset === other.startOffset &&
        range.endContainer === other.endContainer &&
        range.endOffset === other.endOffset
      );
    })
  );
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
        MESSAGE_SELECTOR,
      )) {
        const entryId = options.entryIdOf(root.dataset.messageId ?? "");
        for (const highlight of options.highlights.value) {
          if (highlight.anchor.messageId !== entryId) continue;
          const range = locatePassage(root, highlight.anchor);
          if (range) placed.push({ ...highlight, range, root });
        }
      }
    const activeId = options.activeSideChatId.value;
    const next = {
      normal: placed
        .filter((item) => item.sideChatId !== activeId)
        .map((item) => item.range),
      active: placed
        .filter((item) => item.sideChatId === activeId)
        .map((item) => item.range),
    };
    const previous = ownRanges.get(key) ?? { normal: [], active: [] };
    // The same passages in the same places: the shared registry already shows
    // them, so skip rebuilding it.
    if (
      sameRanges(previous.normal, next.normal) &&
      sameRanges(previous.active, next.active)
    )
      return;
    ownRanges.set(key, next);
    publish();
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(place);
  }

  /** Whether a rendered message stands for an entry that has a follow-up. */
  function isHighlightedRoot(root: HTMLElement): boolean {
    const entryId = options.entryIdOf(root.dataset.messageId ?? "");
    return options.highlights.value.some(
      (highlight) => highlight.anchor.messageId === entryId,
    );
  }

  function holdsHighlightedRoot(node: Node): boolean {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches(MESSAGE_SELECTOR) && isHighlightedRoot(node)) return true;
    for (const root of node.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))
      if (isHighlightedRoot(root)) return true;
    return false;
  }

  function holdsPlacedRoot(node: Node): boolean {
    return placed.some(
      (item) => node === item.root || node.contains(item.root),
    );
  }

  /**
   * Whether a mutation can move a marked passage: it changes a message that
   * has a follow-up, mounts such a message, or removes a marked one. Streaming
   * into other messages leaves every placed range where it is.
   */
  function movesPassages(record: MutationRecord): boolean {
    const target =
      record.target instanceof Element
        ? record.target
        : record.target.parentElement;
    const root = target?.closest<HTMLElement>(MESSAGE_SELECTOR);
    if (root) return isHighlightedRoot(root);
    if (record.type !== "childList") return false;
    for (const node of record.addedNodes)
      if (holdsHighlightedRoot(node)) return true;
    for (const node of record.removedNodes)
      if (holdsPlacedRoot(node)) return true;
    return false;
  }

  function onMutations(records: MutationRecord[]): void {
    if (frame) return;
    if (records.some(movesPassages)) schedule();
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
        observer = new MutationObserver(onMutations);
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
