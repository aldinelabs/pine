/** A rectangle in CSS pixels. */
export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where an element sits inside `ancestor` as laid out, before any CSS
 * transform. `getBoundingClientRect` reports the transformed box, so it is
 * off while an ancestor is mid-animation, such as the floating composer
 * growing in from 96%. Null when `ancestor` does not position it.
 */
export function layoutRect(
  element: HTMLElement,
  ancestor: HTMLElement,
): LayoutRect | null {
  let x = 0;
  let y = 0;
  let current: HTMLElement | null = element;
  while (current && current !== ancestor) {
    x += current.offsetLeft;
    y += current.offsetTop;
    const parent: Element | null = current.offsetParent;
    current = parent instanceof HTMLElement ? parent : null;
  }
  if (current !== ancestor) return null;
  return { x, y, width: element.offsetWidth, height: element.offsetHeight };
}

/**
 * The box around what an element's children draw, inside `ancestor`, as
 * laid out. Screen-reader-only children (1px, clipped) and empty ones are
 * left out: they draw nothing.
 */
export function childrenLayoutBounds(
  element: HTMLElement,
  ancestor: HTMLElement,
): LayoutRect | null {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of element.children) {
    if (!(child instanceof HTMLElement)) continue;
    const rect = layoutRect(child, ancestor);
    if (!rect || rect.width <= 1 || rect.height <= 1) continue;
    top = Math.min(top, rect.y);
    left = Math.min(left, rect.x);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  if (!Number.isFinite(top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
