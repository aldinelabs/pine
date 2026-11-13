/**
 * Geometry for the enlarged Markdown image's flight between its place in the
 * document and the middle of the window. Each helper runs once per open or
 * close, never per frame.
 */

export interface FlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The image's flight from the document to the window's middle. */
export const OPEN_MS = 420;
/** The flight back to the document. */
export const CLOSE_MS = 320;
/** Opening and closing with reduced motion, or without a source to fly to. */
export const FADE_MS = 150;
export const CONTROLS_MS = 260;
export const CONTROLS_DELAY_MS = 120;
/** How long the opening waits for a large image to decode before flying. */
export const DECODE_WAIT_MS = 120;

/**
 * The transform that draws an element laid out at `to` over `from`, for an
 * element with `transform-origin: 0 0`. The scale may differ per axis so a
 * sub-pixel aspect difference between the two images does not show.
 */
export function flipTransform(from: FlightRect, to: FlightRect): string {
  const x = from.left - to.left;
  const y = from.top - to.top;
  const scaleX = to.width ? from.width / to.width : 1;
  const scaleY = to.height ? from.height / to.height : 1;
  return `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
}

function intersects(
  rect: FlightRect,
  area: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    rect.left < area.right &&
    rect.left + rect.width > area.left &&
    rect.top < area.bottom &&
    rect.top + rect.height > area.top
  );
}

/**
 * Where the image sits in the document when any of it can be seen: inside
 * the window and inside the scroller around it. Undefined when it was
 * removed, has no size, or is scrolled out of view.
 */
export function visibleSourceRect(
  element: Element | undefined,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): FlightRect | undefined {
  if (!element?.isConnected) return undefined;
  const { left, top, width, height } = element.getBoundingClientRect();
  if (!(width > 0) || !(height > 0)) return undefined;
  const rect = { left, top, width, height };
  if (
    !intersects(rect, {
      left: 0,
      top: 0,
      right: viewport.width,
      bottom: viewport.height,
    })
  ) {
    return undefined;
  }
  const scroller = element.closest('[data-slot="scroll-area-viewport"]');
  if (scroller && !intersects(rect, scroller.getBoundingClientRect())) {
    return undefined;
  }
  return rect;
}

function pixels(style: CSSStyleDeclaration, name: string): number {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** The window's top and bottom safe areas in pixels (phones), else 0. */
export function readSafeAreaInsets(): { top: number; bottom: number } {
  if (typeof document === "undefined") return { top: 0, bottom: 0 };
  const style = getComputedStyle(document.documentElement);
  return {
    top: pixels(style, "--safe-area-top"),
    bottom: pixels(style, "--safe-area-bottom"),
  };
}
