import type { ComputedRef, InjectionKey, Ref, ShallowRef } from "vue";
import {
  computed,
  getCurrentScope,
  inject,
  onMounted,
  onScopeDispose,
  provide,
  shallowRef,
  watch,
} from "vue";
import { animateScrollTop } from "@/lib/animateScroll";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type MessageScrollerDefaultScrollPosition =
  "start" | "end" | "last-anchor";
export type MessageScrollerButtonDirection = "start" | "end";
export type MessageScrollerScrollAlign = "start" | "center" | "end" | "nearest";
export type MessageScrollerScrollDirection = "start" | "end";

export interface MessageScrollerScrollOptions {
  align?: MessageScrollerScrollAlign;
  behavior?: ScrollBehavior;
  scrollMargin?: number;
}

export interface MessageScrollerScrollable {
  start: boolean;
  end: boolean;
}

export interface MessageScrollerVisibilityState {
  currentAnchorId: string | null;
  visibleMessageIds: string[];
}

export interface MessageScrollerProviderProps {
  autoScroll?: boolean;
  defaultScrollPosition?: MessageScrollerDefaultScrollPosition;
  scrollEdgeThreshold?: number;
  scrollPreviousItemPeek?: number;
  scrollMargin?: number;
  /** Glide the follow-bottom scroll while a live turn is streaming; leave
   * false so hydrating or re-entering a finished conversation snaps to the
   * last anchor without an animation. */
  followAnimated?: boolean;
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const DEFAULT_SCROLL_EDGE_THRESHOLD = 8;
const DEFAULT_SCROLL_PREVIOUS_ITEM_PEEK = 64;
const DEFAULT_SCROLL_MARGIN = 0;
const SCROLL_EPSILON = 0.5;
const AUTOSCROLLING_TIMEOUT = 180;

/**
 * Whether a follow-to-bottom scroll should glide. Only a live streaming turn
 * animates: hydrating or re-entering a finished conversation (followAnimated
 * false) snaps to the last anchor so no animation plays on entry.
 */
export function shouldAnimateFollow(
  animated: boolean,
  followAnimated: boolean,
): boolean {
  return animated && followAnimated;
}

const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
]);

const EMPTY_SCROLLABLE: MessageScrollerScrollable = {
  start: false,
  end: false,
};
const EMPTY_VISIBLE_IDS: string[] = [];
const EMPTY_VISIBILITY: MessageScrollerVisibilityState = {
  currentAnchorId: null,
  visibleMessageIds: EMPTY_VISIBLE_IDS,
};

type Mode =
  | "following-bottom"
  | "free-scrolling"
  | "anchored-to-message"
  | "settling-jump";

interface ViewportAnchor {
  element: HTMLElement;
  viewportTop: number;
}

interface PendingScrollToMessage {
  messageId: string;
  options?: MessageScrollerScrollOptions;
}

function scrollableEqual(
  a: MessageScrollerScrollable,
  b: MessageScrollerScrollable,
) {
  return a.start === b.start && a.end === b.end;
}

function visibilityEqual(
  a: MessageScrollerVisibilityState,
  b: MessageScrollerVisibilityState,
) {
  if (
    a.currentAnchorId !== b.currentAnchorId ||
    a.visibleMessageIds.length !== b.visibleMessageIds.length
  ) {
    return false;
  }
  return a.visibleMessageIds.every(
    (id, index) => id === b.visibleMessageIds[index],
  );
}

// -----------------------------------------------------------------------------
// DOM measurement helpers
// -----------------------------------------------------------------------------

function parseNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPadding(element: HTMLElement): { start: number; end: number } {
  const style = window.getComputedStyle(element);
  return {
    end: parseNumber(style.paddingBlockEnd || style.paddingBottom),
    start: parseNumber(style.paddingBlockStart || style.paddingTop),
  };
}

function getContentPadding(spacer: HTMLElement | null): {
  start: number;
  end: number;
} {
  const parent = spacer?.parentElement;
  return parent ? getPadding(parent) : { end: 0, start: 0 };
}

function getRowGap(element: HTMLElement | null): number {
  if (!element) return 0;
  const style = window.getComputedStyle(element);
  const gap = style.rowGap === "normal" ? style.gap : style.rowGap;
  return parseNumber(gap);
}

function getMessageChildren(
  content: HTMLElement,
  spacer: HTMLElement | null,
): HTMLElement[] {
  return Array.from(content.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== spacer,
  );
}

function getElementOffsetTop(
  element: HTMLElement,
  viewport: HTMLElement,
): number {
  const elementRect = element.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  return elementRect.top - viewportRect.top + viewport.scrollTop;
}

function getRelativeTop(element: HTMLElement, viewport: HTMLElement): number {
  return (
    element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
  );
}

export function measureContentHeight({
  content,
  spacer,
}: {
  content: HTMLElement;
  spacer: HTMLElement | null;
  viewport: HTMLElement;
}): number {
  const children = getMessageChildren(content, spacer);
  const padding = getPadding(content);
  const lastChild = children.at(-1);
  if (!lastChild) return padding.start + padding.end;

  // A transcript is an ordered, non-overlapping flex column. Its last message
  // therefore defines the content bottom; measuring every historical message
  // on each streaming resize caused forced-layout work to grow with the whole
  // conversation. Two layout reads keep this independent of message count.
  const contentRect = content.getBoundingClientRect();
  const lastRect = lastChild.getBoundingClientRect();
  return Math.max(
    padding.start + padding.end,
    lastRect.bottom - contentRect.top + padding.end,
  );
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function isAtScrollEnd(element: HTMLElement): boolean {
  return maxScrollTop(element) - element.scrollTop <= SCROLL_EPSILON;
}

function computeSpacerHeight({
  content,
  scrollTop,
  spacer,
  viewport,
}: {
  content: HTMLElement;
  scrollTop: number;
  spacer: HTMLElement | null;
  viewport: HTMLElement;
}): number {
  const contentHeight = measureContentHeight({ content, spacer, viewport });
  return scrollTop + viewport.clientHeight - contentHeight;
}

function computeScrollTopForElement({
  align,
  element,
  scrollMargin,
  spacer,
  viewport,
}: {
  align: MessageScrollerScrollAlign;
  element: HTMLElement;
  scrollMargin: number;
  spacer: HTMLElement | null;
  viewport: HTMLElement;
}): number {
  const offsetTop = getElementOffsetTop(element, viewport);
  const height = element.getBoundingClientRect().height;
  const padding = getContentPadding(spacer);

  if (align === "center") {
    const available = Math.max(
      0,
      viewport.clientHeight - padding.start - padding.end,
    );
    return offsetTop - padding.start - (available - height) / 2 - scrollMargin;
  }
  if (align === "end")
    return (
      offsetTop - viewport.clientHeight + height + padding.end + scrollMargin
    );
  if (align === "nearest") {
    const bottom = offsetTop + height;
    const visibleTop = viewport.scrollTop + padding.start;
    const visibleBottom =
      viewport.scrollTop + viewport.clientHeight - padding.end;
    if (offsetTop >= visibleTop && bottom <= visibleBottom)
      return viewport.scrollTop;
    return offsetTop < visibleTop
      ? offsetTop - padding.start - scrollMargin
      : bottom - viewport.clientHeight + padding.end + scrollMargin;
  }
  return offsetTop - padding.start - scrollMargin;
}

function computeScrollable({
  content,
  scrollEdgeThreshold,
  spacer,
  viewport,
}: {
  content: HTMLElement | null;
  scrollEdgeThreshold: number;
  spacer: HTMLElement | null;
  viewport: HTMLElement | null;
}): MessageScrollerScrollable {
  if (!viewport || !content) return EMPTY_SCROLLABLE;
  const contentHeight = measureContentHeight({ content, spacer, viewport });
  return {
    start: viewport.scrollTop > scrollEdgeThreshold,
    end:
      contentHeight - viewport.scrollTop - viewport.clientHeight >
      scrollEdgeThreshold,
  };
}

function computeVisibility({
  content,
  scrollMargin,
  scrollPreviousItemPeek,
  spacer,
  viewport,
  visibleMessageIds,
}: {
  content: HTMLElement | null;
  scrollMargin: number;
  scrollPreviousItemPeek: number;
  spacer: HTMLElement | null;
  viewport: HTMLElement | null;
  visibleMessageIds: Set<string>;
}): MessageScrollerVisibilityState {
  if (!content || !viewport) return EMPTY_VISIBILITY;
  const viewportRect = viewport.getBoundingClientRect();
  const anchorLine = viewportRect.top + scrollMargin + scrollPreviousItemPeek;
  const noIntersectionObserver = typeof IntersectionObserver === "undefined";
  const children = getMessageChildren(content, spacer);
  const visible: string[] = [];
  const anchorsBelowLine = new Set<string>();
  let currentAnchorId: string | null = null;
  let firstVisibleIndex = -1;

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const messageId = child.dataset.messageId;
    if (!messageId) continue;
    const isAnchor = child.dataset.scrollAnchor === "true";
    const rect = noIntersectionObserver ? child.getBoundingClientRect() : null;
    const isVisible =
      noIntersectionObserver && rect
        ? rect.bottom > anchorLine && rect.top < viewportRect.bottom
        : visibleMessageIds.has(messageId);
    if (isVisible) {
      if (firstVisibleIndex < 0) firstVisibleIndex = index;
      visible.push(messageId);
      if (isAnchor) {
        const anchorRect = rect ?? child.getBoundingClientRect();
        if (anchorRect.top <= anchorLine + SCROLL_EPSILON) {
          currentAnchorId = messageId;
        } else {
          anchorsBelowLine.add(messageId);
        }
      }
    }
  }

  // When one assistant response is taller than the viewport its owning user
  // anchor is offscreen. Walk DOM siblings without layout reads to recover it.
  if (currentAnchorId === null && firstVisibleIndex >= 0) {
    for (let index = firstVisibleIndex; index >= 0; index--) {
      const child = children[index];
      const messageId = child.dataset.messageId;
      if (
        child.dataset.scrollAnchor === "true" &&
        messageId &&
        !anchorsBelowLine.has(messageId)
      ) {
        currentAnchorId = messageId;
        break;
      }
    }
  }

  return visible.length === 0 && currentAnchorId === null
    ? EMPTY_VISIBILITY
    : { currentAnchorId, visibleMessageIds: visible };
}

function findFirstAnchorFrom(
  elements: HTMLElement[],
  startIndex: number,
): HTMLElement | null {
  for (let i = startIndex; i < elements.length; i++) {
    const element = elements[i];
    if (element?.dataset.scrollAnchor === "true") return element;
  }
  return null;
}

function findFirstUnhandledAnchor(
  elements: HTMLElement[],
  handled: WeakSet<HTMLElement>,
): HTMLElement | null {
  for (const element of elements) {
    if (element.dataset.scrollAnchor === "true" && !handled.has(element))
      return element;
  }
  return null;
}

function hasMultipleAnchorsFrom(
  elements: HTMLElement[],
  startIndex: number,
): boolean {
  let count = 0;
  for (let i = startIndex; i < elements.length; i++) {
    if (elements[i]?.dataset.scrollAnchor === "true") {
      count += 1;
      if (count > 1) return true;
    }
  }
  return false;
}

function findLastAnchor(elements: HTMLElement[]): HTMLElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (element?.dataset.scrollAnchor === "true") return element;
  }
  return null;
}

function findFirstVisibleMessage({
  content,
  spacer,
  viewport,
  visibleMessageIds,
}: {
  content: HTMLElement;
  spacer: HTMLElement | null;
  viewport: HTMLElement;
  visibleMessageIds: Set<string>;
}): HTMLElement | null {
  const children = getMessageChildren(content, spacer);
  // Fast path: the IntersectionObserver already tracks which messages
  // intersect the viewport, so pick the topmost one without any layout read.
  // captureViewportAnchor runs on every content change and scroll event; a
  // rect walk here forces layout for every earlier sibling and made streaming
  // in long transcripts quadratic.
  if (visibleMessageIds.size > 0) {
    for (const child of children) {
      const messageId = child.dataset.messageId;
      if (messageId && visibleMessageIds.has(messageId)) return child;
    }
  }
  const viewportRect = viewport.getBoundingClientRect();
  for (const child of children) {
    if (!child.dataset.messageId) continue;
    const rect = child.getBoundingClientRect();
    if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom)
      return child;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

export interface MessageScrollerContext {
  autoscrolling: Readonly<ShallowRef<boolean>>;
  isProgrammaticScroll: Readonly<ShallowRef<boolean>>;
  userScrollRevision: Readonly<ShallowRef<number>>;
  scrollable: Readonly<ShallowRef<MessageScrollerScrollable>>;
  scrollableAttr: ComputedRef<string | undefined>;
  visibility: Readonly<ShallowRef<MessageScrollerVisibilityState>>;
  acquireVisibility: () => void;
  releaseVisibility: () => void;
  handleContentChange: () => void;
  handleResize: () => void;
  followStreamingContent: () => void;
  scrollToEnd: (options?: { behavior?: ScrollBehavior }) => boolean;
  scrollToMessage: (
    messageId: string,
    options?: MessageScrollerScrollOptions,
  ) => boolean;
  scrollToStart: (options?: { behavior?: ScrollBehavior }) => boolean;
  setContentElement: (element: HTMLElement | null) => void;
  setProgrammaticScroll: (active: boolean) => void;
  setSpacerElement: (element: HTMLElement | null) => void;
  setViewportElement: (element: HTMLElement | null) => void;
  setPreserveScrollOnPrepend: (value: boolean) => void;
  syncAfterScroll: () => void;
  userScrollIntent: (direction?: MessageScrollerScrollDirection) => void;
}

export type RegisterMessage = (
  messageId: string,
  element: HTMLElement | null,
  previousElement: HTMLElement | null,
) => void;

const CONTEXT_KEY: InjectionKey<MessageScrollerContext> = Symbol(
  "MessageScrollerContext",
);
const REGISTER_KEY: InjectionKey<RegisterMessage> = Symbol(
  "MessageScrollerRegister",
);

function createEngine(props: MessageScrollerProviderProps) {
  const autoScroll = () => props.autoScroll ?? false;
  const defaultScrollPosition = () => props.defaultScrollPosition ?? "end";
  const scrollEdgeThreshold = () =>
    props.scrollEdgeThreshold ?? DEFAULT_SCROLL_EDGE_THRESHOLD;
  const scrollPreviousItemPeek = () =>
    props.scrollPreviousItemPeek ?? DEFAULT_SCROLL_PREVIOUS_ITEM_PEEK;
  const scrollMargin = () => props.scrollMargin ?? DEFAULT_SCROLL_MARGIN;
  const followAnimated = () => props.followAnimated ?? false;

  let viewport: HTMLElement | null = null;
  let content: HTMLElement | null = null;
  let spacer: HTMLElement | null = null;
  let spacerGap = 0;
  let spacerHeight = 0;
  let spacerAnchor: {
    align: MessageScrollerScrollAlign;
    element: HTMLElement;
    scrollMargin: number;
  } | null = null;
  let mode: Mode = autoScroll() ? "following-bottom" : "free-scrolling";
  let streamingTurn: HTMLElement | null = null;
  let firstItem: HTMLElement | null = null;
  let itemCount = 0;
  let lastScrollTop = 0;
  let defaultScrollPositionApplied = false;
  let preserveScrollOnPrepend = true;
  let viewportAnchor: ViewportAnchor | null = null;
  let pendingScrollToMessage: PendingScrollToMessage | null = null;
  let stateFrame: number | null = null;
  let visibilityFrame: number | null = null;
  let pendingScrollFrame: number | null = null;
  let autoscrollingTimeout: number | null = null;
  let cancelScrollAnimation: (() => void) | null = null;
  let visibilityObserver: IntersectionObserver | null = null;
  let visibilityConsumers = 0;
  const messageElements = new Map<string, HTMLElement>();
  const visibleMessageIds = new Set<string>();
  const handledScrollAnchors = new WeakSet<HTMLElement>();

  const autoscrolling = shallowRef(false);
  const isProgrammaticScroll = shallowRef(false);
  const userScrollRevision = shallowRef(0);
  const scrollable = shallowRef<MessageScrollerScrollable>(EMPTY_SCROLLABLE);
  const visibility =
    shallowRef<MessageScrollerVisibilityState>(EMPTY_VISIBILITY);
  const scrollableAttr = computed(() => {
    const attr = [
      scrollable.value.start && "start",
      scrollable.value.end && "end",
    ]
      .filter(Boolean)
      .join(" ");
    return attr || undefined;
  });

  // --- scroll-state commit / visibility scheduling ---------------------------

  function updateModeFromScroll(next: MessageScrollerScrollable) {
    const scrollTop = viewport?.scrollTop ?? 0;
    const scrolledUp = scrollTop < lastScrollTop - SCROLL_EPSILON;
    const scrolledDown = scrollTop > lastScrollTop + SCROLL_EPSILON;
    lastScrollTop = scrollTop;
    if (
      autoScroll() &&
      !next.end &&
      // A resize or a small upward wheel delta inside the edge threshold must
      // not undo userScrollIntent. Resume only after scrolling down to the edge.
      (mode === "following-bottom" || scrolledDown) &&
      mode !== "settling-jump" &&
      mode !== "anchored-to-message"
    ) {
      mode = "following-bottom";
      clearSpacer();
    } else if (
      mode === "following-bottom" &&
      next.end &&
      scrolledUp &&
      !autoscrolling.value
    ) {
      mode = "free-scrolling";
    }
  }

  function commitScrollState() {
    const measured = computeScrollable({
      content,
      scrollEdgeThreshold: scrollEdgeThreshold(),
      spacer,
      viewport,
    });
    updateModeFromScroll(measured);
    const next =
      mode === "following-bottom" ? { ...measured, end: false } : measured;
    if (!scrollableEqual(scrollable.value, next)) scrollable.value = next;
  }

  function scheduleStateCommit() {
    if (stateFrame === null) {
      stateFrame = window.requestAnimationFrame(() => {
        stateFrame = null;
        commitScrollState();
      });
    }
  }

  function scheduleVisibilitySync() {
    if (visibilityConsumers === 0) return;
    if (visibilityFrame === null) {
      visibilityFrame = window.requestAnimationFrame(() => {
        visibilityFrame = null;
        if (visibilityConsumers > 0) {
          const next = computeVisibility({
            content,
            scrollMargin: scrollMargin(),
            scrollPreviousItemPeek: scrollPreviousItemPeek(),
            spacer,
            viewport,
            visibleMessageIds,
          });
          if (!visibilityEqual(visibility.value, next)) visibility.value = next;
        }
      });
    }
  }

  // --- imperative scroll primitives ------------------------------------------

  function setAutoscrolling(active: boolean) {
    if (autoscrollingTimeout !== null) {
      window.clearTimeout(autoscrollingTimeout);
      autoscrollingTimeout = null;
    }
    if (autoscrolling.value !== active) {
      autoscrolling.value = active;
      commitScrollState();
    }
    if (active) {
      autoscrollingTimeout = window.setTimeout(() => {
        autoscrollingTimeout = null;
        autoscrolling.value = false;
        commitScrollState();
      }, AUTOSCROLLING_TIMEOUT);
    }
  }

  function setSpacerHeight(height: number) {
    if (!spacer) return;
    const next = Math.max(0, Math.ceil(height));
    if (spacerHeight !== next) {
      spacerHeight = next;
      spacer.hidden = next === 0;
      spacer.style.height = `${next}px`;
      spacer.style.marginTop = next > 0 ? `${-spacerGap}px` : "";
    }
  }

  function clearSpacer() {
    setSpacerHeight(0);
    spacerAnchor = null;
  }

  function scrollTo(
    top: number,
    {
      behavior = "auto",
      autoscrolling: isAutoscrolling = false,
      animated = false,
    }: {
      behavior?: ScrollBehavior;
      autoscrolling?: boolean;
      animated?: boolean;
    } = {},
  ) {
    if (!viewport) return;
    cancelScrollAnimation?.();
    cancelScrollAnimation = null;
    const target = Math.max(0, top);
    if (Math.abs(viewport.scrollTop - target) <= SCROLL_EPSILON) {
      viewport.scrollTop = target;
      commitScrollState();
      return;
    }
    if (shouldAnimateFollow(animated, followAnimated())) {
      // Shared expo-curve tween (see lib/animateScroll). Retarget-safe for
      // streaming follow; wheel/touch input cancels it via the lib. Only a
      // live turn glides — hydrating or re-entering a finished conversation
      // snaps to the anchor so no animation plays on entry.
      if (isAutoscrolling) setAutoscrolling(true);
      cancelScrollAnimation = animateScrollTop(viewport, target);
      scheduleStateCommit();
      return;
    }
    if (isAutoscrolling) setAutoscrolling(true);
    viewport.scrollTo({ top: target, behavior });
    scheduleStateCommit();
  }

  function scrollToStart({
    behavior = "auto",
  }: { behavior?: ScrollBehavior } = {}): boolean {
    if (!viewport) return false;
    setProgrammaticScroll(false);
    clearSpacer();
    streamingTurn = null;
    mode = "free-scrolling";
    scrollTo(0, { behavior });
    scheduleVisibilitySync();
    return true;
  }

  function scrollToEnd({
    behavior = "auto",
    animated = false,
  }: { behavior?: ScrollBehavior; animated?: boolean } = {}): boolean {
    if (!viewport) return false;
    setProgrammaticScroll(false);
    clearSpacer();
    streamingTurn = null;
    mode = autoScroll() ? "following-bottom" : "free-scrolling";
    scrollTo(maxScrollTop(viewport), {
      autoscrolling: true,
      behavior,
      animated,
    });
    scheduleVisibilitySync();
    return true;
  }

  function followStreamingContent() {
    if (!autoScroll() || mode !== "following-bottom") return;
    // An anchored turn keeps the user's message in place while the response
    // grows. Its ResizeObserver callback recomputes the tail spacer, so
    // clearing that spacer here would make the viewport jump before the
    // response has filled the available space.
    scrollToEnd({ behavior: "auto", animated: true });
  }

  function updateSpacerForAnchor(): number | null {
    if (!spacerAnchor || !content || !viewport) return null;
    const { align, element, scrollMargin: margin } = spacerAnchor;
    if (!content.contains(element)) {
      clearSpacer();
      return null;
    }
    const targetScrollTop = computeScrollTopForElement({
      align,
      element,
      scrollMargin: margin,
      spacer,
      viewport,
    });
    setSpacerHeight(
      computeSpacerHeight({
        content,
        scrollTop: targetScrollTop,
        spacer,
        viewport,
      }),
    );
    // Reconcile the estimate with the browser's actual scroll range.
    if (spacerHeight > 0)
      setSpacerHeight(spacerHeight + targetScrollTop - maxScrollTop(viewport));
    if (spacerHeight === 0) spacerAnchor = null;
    return targetScrollTop;
  }

  function scrollToElement(
    element: HTMLElement,
    {
      align = "start",
      behavior = "auto",
      scrollMargin: margin = scrollMargin(),
    }: MessageScrollerScrollOptions = {},
    { keepPreviousPeek = false }: { keepPreviousPeek?: boolean } = {},
  ): boolean {
    if (!content || !viewport || !content.contains(element)) return false;
    spacerAnchor = {
      align,
      element,
      scrollMargin: keepPreviousPeek
        ? margin + scrollPreviousItemPeek()
        : margin,
    };
    const targetScrollTop = updateSpacerForAnchor();
    if (targetScrollTop === null) return false;
    viewportAnchor = {
      element,
      viewportTop: getRelativeTop(element, viewport),
    };
    mode = keepPreviousPeek ? "anchored-to-message" : "settling-jump";
    streamingTurn = keepPreviousPeek ? element : null;
    scrollTo(targetScrollTop, { behavior });
    scheduleVisibilitySync();
    return true;
  }

  function reanchorToAnchoredMessage(): boolean {
    if (
      !streamingTurn ||
      !streamingTurn.isConnected ||
      mode !== "anchored-to-message"
    )
      return false;
    return scrollToElement(
      streamingTurn,
      { align: "start" },
      { keepPreviousPeek: true },
    );
  }

  function scrollToMessage(
    messageId: string,
    options?: MessageScrollerScrollOptions,
  ): boolean {
    setProgrammaticScroll(true);
    const element = messageElements.get(messageId);
    if (element) {
      defaultScrollPositionApplied = true;
      if (scrollToElement(element, options)) {
        pendingScrollToMessage = null;
        return true;
      }
      pendingScrollToMessage = { messageId, options };
      return true;
    }
    if (itemCount === 0) {
      pendingScrollToMessage = { messageId, options };
      defaultScrollPositionApplied = true;
      return true;
    }
    return false;
  }

  function flushPendingScrollToMessage(): boolean {
    if (!pendingScrollToMessage) return false;
    const element = messageElements.get(pendingScrollToMessage.messageId);
    if (!element || !scrollToElement(element, pendingScrollToMessage.options))
      return false;
    pendingScrollToMessage = null;
    defaultScrollPositionApplied = true;
    return true;
  }

  // --- viewport anchoring ----------------------------------------------------

  function applyViewportAnchorRestore(): boolean {
    if (!viewportAnchor || !viewport || !viewportAnchor.element.isConnected)
      return false;
    const delta =
      getRelativeTop(viewportAnchor.element, viewport) -
      viewportAnchor.viewportTop;
    if (Math.abs(delta) <= SCROLL_EPSILON) return false;
    viewport.scrollTop += delta;
    viewportAnchor.viewportTop = getRelativeTop(
      viewportAnchor.element,
      viewport,
    );
    scheduleStateCommit();
    scheduleVisibilitySync();
    return true;
  }

  function captureViewportAnchor() {
    if (!content || !viewport) {
      viewportAnchor = null;
      return;
    }
    // While following the bottom the anchor is meaningless — the viewport is
    // pinned to live content and grows below the fold. Capturing it would
    // walk the transcript on every content change and scroll event.
    if (autoScroll() && mode === "following-bottom") {
      viewportAnchor = null;
      return;
    }
    const element = findFirstVisibleMessage({
      content,
      spacer,
      viewport,
      visibleMessageIds,
    });
    viewportAnchor = element
      ? { element, viewportTop: getRelativeTop(element, viewport) }
      : null;
  }

  function schedulePrependFlush() {
    if (pendingScrollFrame === null) {
      pendingScrollFrame = window.requestAnimationFrame(() => {
        pendingScrollFrame = null;
        if (flushPendingScrollToMessage()) captureViewportAnchor();
      });
    }
  }

  // --- default scroll position -----------------------------------------------

  function applyDefaultScrollPosition(): boolean {
    if (defaultScrollPositionApplied || itemCount === 0) return false;
    const position = defaultScrollPosition();
    let applied = false;
    if (position === "last-anchor") {
      const lastAnchor =
        content && viewport
          ? findLastAnchor(getMessageChildren(content, spacer))
          : null;
      if (!content || !viewport || !lastAnchor) {
        applied = scrollToEnd({ behavior: "auto" });
      } else {
        const anchorOffset = getElementOffsetTop(lastAnchor, viewport);
        const contentHeight = measureContentHeight({
          content,
          spacer,
          viewport,
        });
        applied =
          contentHeight - anchorOffset <= viewport.clientHeight
            ? scrollToEnd({ behavior: "auto" })
            : scrollToElement(
                lastAnchor,
                { align: "start" },
                { keepPreviousPeek: true },
              );
      }
    } else {
      applied =
        position === "end"
          ? scrollToEnd({ behavior: "auto" })
          : scrollToStart({ behavior: "auto" });
    }
    if (applied) {
      defaultScrollPositionApplied = true;
      return true;
    }
    return false;
  }

  // --- content / resize handling ---------------------------------------------

  function applyContentChange(
    children: HTMLElement[],
    previousCount: number,
    previousFirst: HTMLElement | null,
  ) {
    if (flushPendingScrollToMessage()) return;
    if (mode === "settling-jump" && isProgrammaticScroll.value) {
      scheduleStateCommit();
      scheduleVisibilitySync();
      return;
    }
    if (previousCount === 0) {
      if (
        applyDefaultScrollPosition() ||
        (children.length > 0 &&
          autoScroll() &&
          scrollToEnd({ behavior: "auto" }))
      ) {
        return;
      }
      commitScrollState();
      scheduleVisibilitySync();
      return;
    }
    const previousIndex = previousFirst ? children.indexOf(previousFirst) : -1;
    if (preserveScrollOnPrepend && previousIndex > 0) {
      applyViewportAnchorRestore();
      return;
    }
    if (children.length > previousCount) {
      const anchor = findFirstAnchorFrom(children, previousCount);
      if (anchor) {
        if (
          autoScroll() &&
          mode === "following-bottom" &&
          hasMultipleAnchorsFrom(children, previousCount)
        ) {
          scrollToEnd({ behavior: "auto" });
          return;
        }
        scrollToElement(anchor, { align: "start" }, { keepPreviousPeek: true });
        handledScrollAnchors.add(anchor);
        return;
      }
    }
    if (children.length === previousCount) {
      const anchor = findFirstUnhandledAnchor(children, handledScrollAnchors);
      if (anchor) {
        scrollToElement(anchor, { align: "start" }, { keepPreviousPeek: true });
        handledScrollAnchors.add(anchor);
        return;
      }
    }
    if (mode === "following-bottom" && autoScroll()) {
      // Incremental growth within loaded messages glides like resize-driven
      // follow above; big repositions (initial load, multi-anchor jumps)
      // stay instant on purpose.
      scrollToEnd({ behavior: "auto", animated: true });
    } else {
      commitScrollState();
      scheduleVisibilitySync();
    }
  }

  function handleContentChange() {
    if (!content) return;
    const children = getMessageChildren(content, spacer);
    const previousCount = itemCount;
    const previousFirst = firstItem;
    itemCount = children.length;
    firstItem = children[0] ?? null;

    applyContentChange(children, previousCount, previousFirst);
    if (!isProgrammaticScroll.value) captureViewportAnchor();
  }

  function handleResize() {
    if (mode === "settling-jump" && isProgrammaticScroll.value) {
      scheduleStateCommit();
      scheduleVisibilitySync();
      return;
    }
    if (mode === "following-bottom" && autoScroll()) {
      // Streaming growth lands here; glide instead of snapping.
      scrollToEnd({ behavior: "auto", animated: true });
      return;
    }
    const previousSpacerHeight = spacerHeight;
    if (reanchorToAnchoredMessage()) {
      // The reply streaming below the anchor consumes the tail spacer as it
      // grows. Once the last of it is gone the reply has filled the viewport
      // and the reader is genuinely at the live edge, so autoScroll hands off
      // from the anchor hold to following the bottom. Requiring the >0 → 0
      // transition keeps a turn taller than the viewport (placed with no
      // spacer) held instead of yanked to the end.
      if (autoScroll() && previousSpacerHeight > 0 && spacerHeight === 0)
        scrollToEnd({ behavior: "auto", animated: true });
      return;
    }
    // User scroll intent releases the held viewport position, but the reply
    // must still consume the remaining tail space as it grows.
    if (spacerHeight > 0) updateSpacerForAnchor();
    // Markdown, syntax highlighting, fonts, and media may settle after the
    // scroll event. Preserve the first visible message across those async
    // height changes instead of relying on browser scroll anchoring heuristics.
    if (applyViewportAnchorRestore()) return;
    scheduleStateCommit();
    scheduleVisibilitySync();
  }

  // --- visibility observation ------------------------------------------------

  function observeVisibility() {
    if (!viewport || visibilityConsumers === 0) return;
    if (typeof IntersectionObserver === "undefined") {
      scheduleVisibilitySync();
      return;
    }
    if (!visibilityObserver) {
      visibilityObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const messageId = (entry.target as HTMLElement).dataset.messageId;
            if (!messageId) continue;
            if (entry.isIntersecting) visibleMessageIds.add(messageId);
            else visibleMessageIds.delete(messageId);
          }
          scheduleVisibilitySync();
        },
        {
          root: viewport,
          rootMargin: `${-(scrollMargin() + scrollPreviousItemPeek())}px 0px 0px 0px`,
          threshold: [0, 0.01, 0.5, 1],
        },
      );
    }
    messageElements.forEach((element) => {
      visibilityObserver?.observe(element);
    });
    scheduleVisibilitySync();
  }

  function unobserveVisibility() {
    if (visibilityFrame !== null) {
      window.cancelAnimationFrame(visibilityFrame);
      visibilityFrame = null;
    }
    visibilityObserver?.disconnect();
    visibilityObserver = null;
    visibleMessageIds.clear();
    if (!visibilityEqual(visibility.value, EMPTY_VISIBILITY))
      visibility.value = EMPTY_VISIBILITY;
  }

  function acquireVisibility() {
    visibilityConsumers += 1;
    if (visibilityConsumers === 1) observeVisibility();
  }

  function releaseVisibility() {
    visibilityConsumers -= 1;
    if (visibilityConsumers === 0) unobserveVisibility();
  }

  const registerMessage: RegisterMessage = (
    messageId,
    element,
    previousElement,
  ) => {
    if (element) {
      messageElements.set(messageId, element);
      visibilityObserver?.observe(element);
      scheduleVisibilitySync();
      if (pendingScrollToMessage?.messageId === messageId)
        schedulePrependFlush();
      return;
    }
    if (previousElement && messageElements.get(messageId) === previousElement) {
      messageElements.delete(messageId);
      visibleMessageIds.delete(messageId);
      visibilityObserver?.unobserve(previousElement);
      scheduleVisibilitySync();
    }
  };

  // --- user intent + element setters -----------------------------------------

  function setProgrammaticScroll(active: boolean): void {
    isProgrammaticScroll.value = active;
  }

  function userScrollIntent(direction?: MessageScrollerScrollDirection) {
    userScrollRevision.value += 1;
    setProgrammaticScroll(false);
    cancelScrollAnimation?.();
    cancelScrollAnimation = null;
    if (
      autoScroll() &&
      direction === "end" &&
      viewport &&
      isAtScrollEnd(viewport)
    ) {
      streamingTurn = null;
      mode = "following-bottom";
      clearSpacer();
      lastScrollTop = viewport.scrollTop;
      setAutoscrolling(false);
      return;
    }
    if (
      mode === "following-bottom" ||
      mode === "anchored-to-message" ||
      mode === "settling-jump"
    ) {
      streamingTurn = null;
      mode = "free-scrolling";
    }
    // Consume the last programmatic position before the user's scroll event,
    // so pending observers cannot mistake animation progress for a down-scroll.
    lastScrollTop = viewport?.scrollTop ?? 0;
    setAutoscrolling(false);
  }

  function setViewportElement(element: HTMLElement | null) {
    viewport = element;
    // A visibility consumer may have subscribed before the viewport mounted,
    // in which case observeVisibility() bailed out. Retry now it exists.
    if (element) observeVisibility();
  }

  function setContentElement(element: HTMLElement | null) {
    content = element;
  }

  function setSpacerElement(element: HTMLElement | null) {
    spacer = element;
    spacerGap = getRowGap(element?.parentElement ?? null);
  }

  function setPreserveScrollOnPrepend(value: boolean) {
    preserveScrollOnPrepend = value;
  }

  function syncAfterScroll() {
    commitScrollState();
    scheduleVisibilitySync();
    captureViewportAnchor();
  }

  function onAutoScrollChange() {
    if (autoScroll() && mode === "following-bottom" && itemCount > 0) {
      scrollToEnd({ behavior: "auto" });
      return;
    }
    commitScrollState();
  }

  function destroy() {
    cancelScrollAnimation?.();
    cancelScrollAnimation = null;
    if (stateFrame !== null) {
      window.cancelAnimationFrame(stateFrame);
      stateFrame = null;
    }
    if (visibilityFrame !== null) {
      window.cancelAnimationFrame(visibilityFrame);
      visibilityFrame = null;
    }
    if (autoscrollingTimeout !== null) {
      window.clearTimeout(autoscrollingTimeout);
      autoscrollingTimeout = null;
    }
    if (pendingScrollFrame !== null) {
      window.cancelAnimationFrame(pendingScrollFrame);
      pendingScrollFrame = null;
    }
    visibilityObserver?.disconnect();
    visibilityObserver = null;
  }

  const context: MessageScrollerContext = {
    autoscrolling,
    isProgrammaticScroll,
    userScrollRevision,
    scrollable,
    scrollableAttr,
    visibility,
    acquireVisibility,
    releaseVisibility,
    handleContentChange,
    handleResize,
    followStreamingContent,
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
    setContentElement,
    setProgrammaticScroll,
    setSpacerElement,
    setViewportElement,
    setPreserveScrollOnPrepend,
    syncAfterScroll,
    userScrollIntent,
  };

  return {
    context,
    registerMessage,
    applyDefaultScrollPosition,
    onAutoScrollChange,
    destroy,
  };
}

// -----------------------------------------------------------------------------
// Provider wiring (provide/inject)
// -----------------------------------------------------------------------------

export function provideMessageScroller(props: MessageScrollerProviderProps) {
  const engine = createEngine(props);
  provide(CONTEXT_KEY, engine.context);
  provide(REGISTER_KEY, engine.registerMessage);

  watch(
    () => props.autoScroll ?? false,
    () => engine.onAutoScrollChange(),
  );

  onMounted(() => {
    engine.applyDefaultScrollPosition();
    // The viewport element attaches in MessageScrollerViewport's onMounted,
    // after MessageScrollerContent ran its initial handleContentChange without
    // it. Re-sync now that every element is wired up.
    engine.context.syncAfterScroll();
  });

  onScopeDispose(() => engine.destroy());

  return engine;
}

export function useMessageScrollerContext(): MessageScrollerContext {
  const context = inject(CONTEXT_KEY, null);
  if (!context)
    throw new Error(
      "useMessageScroller must be used within a MessageScroller.",
    );
  return context;
}

export function useOptionalMessageScrollerContext(): MessageScrollerContext | null {
  return inject(CONTEXT_KEY, null);
}

export function useMessageScrollerRegister(): RegisterMessage {
  const register = inject(REGISTER_KEY, null);
  if (!register)
    throw new Error(
      "MessageScrollerItem must be used within a MessageScroller.",
    );
  return register;
}

// -----------------------------------------------------------------------------
// Public composables
// -----------------------------------------------------------------------------

export function useMessageScroller() {
  const { scrollToEnd, scrollToMessage, scrollToStart, setProgrammaticScroll } =
    useMessageScrollerContext();
  return {
    scrollToEnd,
    scrollToMessage,
    scrollToStart,
    setProgrammaticScroll,
  };
}

export function useMessageScrollerScrollable(): Ref<MessageScrollerScrollable> {
  const { scrollable } = useMessageScrollerContext();
  return computed(() => scrollable.value);
}

export function useMessageScrollerVisibility(): Ref<MessageScrollerVisibilityState> {
  const { acquireVisibility, releaseVisibility, visibility } =
    useMessageScrollerContext();
  acquireVisibility();
  if (getCurrentScope()) onScopeDispose(releaseVisibility);
  return computed(() => visibility.value);
}

export { SCROLL_KEYS };
