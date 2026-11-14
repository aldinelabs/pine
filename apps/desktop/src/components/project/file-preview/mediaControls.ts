/** Playback speeds offered by the media controls. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/** A stretch of a recording, in seconds. */
export interface TimeSpan {
  start: number;
  end: number;
}

export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(0, time), Math.max(0, duration));
}

/** The time under `clientX` on a timeline drawn in `rect`. */
export function timeAtPosition(
  clientX: number,
  rect: Pick<DOMRect, "left" | "width">,
  duration: number,
): number {
  if (!rect.width || !duration) return 0;
  return clampTime(((clientX - rect.left) / rect.width) * duration, duration);
}

/** Two marked times as a span, earlier first, to a tenth of a second. */
export function normalizeSpan(a: number, b: number): TimeSpan {
  const round = (value: number) => Math.round(value * 10) / 10;
  return { start: round(Math.min(a, b)), end: round(Math.max(a, b)) };
}

/** Where a span sits on the timeline, as percentages of its width. */
export function spanPercent(
  span: TimeSpan,
  duration: number,
): { left: number; width: number } {
  if (!duration) return { left: 0, width: 0 };
  const start = clampTime(span.start, duration);
  const end = clampTime(span.end, duration);
  return {
    left: (start / duration) * 100,
    width: (Math.max(0, end - start) / duration) * 100,
  };
}

/** A span's box on a timeline drawn in `rect`, in the same coordinates. */
export function spanRect(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  span: TimeSpan,
  duration: number,
): DOMRect {
  const { left, width } = spanPercent(span, duration);
  return new DOMRect(
    rect.left + (rect.width * left) / 100,
    rect.top,
    Math.max(1, (rect.width * width) / 100),
    rect.height,
  );
}

export type MediaShortcut =
  | "toggle"
  | "back"
  | "forward"
  | "backLong"
  | "forwardLong"
  | "mute"
  | "fullscreen"
  | "markIn"
  | "markOut"
  | "clearMarks";

const SHORTCUTS: Record<string, MediaShortcut> = {
  " ": "toggle",
  k: "toggle",
  ArrowLeft: "back",
  ArrowRight: "forward",
  j: "backLong",
  l: "forwardLong",
  m: "mute",
  f: "fullscreen",
  i: "markIn",
  o: "markOut",
  Escape: "clearMarks",
};

/** Seconds each seek shortcut moves by. */
export const SHORTCUT_SEEK: Partial<Record<MediaShortcut, number>> = {
  back: -5,
  forward: 5,
  backLong: -10,
  forwardLong: 10,
};

function isEditable(element: Element): boolean {
  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ),
  );
}

/**
 * The player shortcut a key press means, or nothing when it belongs to
 * something else: a field being typed in, a control that uses the key
 * itself, or focus outside the player (`scope`) other than the page body.
 */
export function mediaShortcut(
  event: KeyboardEvent,
  scope: Element | null | undefined,
): MediaShortcut | undefined {
  if (event.defaultPrevented || event.isComposing) return undefined;
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const shortcut = SHORTCUTS[key];
  if (!shortcut) return undefined;
  const target = event.target instanceof Element ? event.target : undefined;
  if (!target || target === target.ownerDocument.body) return shortcut;
  if (!scope?.contains(target) || isEditable(target)) return undefined;
  // Buttons press on Space, sliders and menus move on arrows.
  if (key === " " && target.closest("button, [role='button']"))
    return undefined;
  if (
    target.closest("[role='slider'], [role='menu'], [role='menuitem']") &&
    (key === "ArrowLeft" || key === "ArrowRight" || key === " ")
  )
    return undefined;
  return shortcut;
}
