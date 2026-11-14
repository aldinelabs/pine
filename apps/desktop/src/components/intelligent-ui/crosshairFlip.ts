/**
 * Eases a chart crosshair between data points.
 *
 * Unovis restarts a short linear transition on every pointer move, even when
 * the crosshair stays on the same point, so its motion stutters and never
 * eases. The chart turns those transitions off (duration 0); this observer
 * then sees each jump of the line and the dots and plays it back as a FLIP:
 * the element is moved back by the jump and slides to its place on the app's
 * curve. A new jump mid-slide starts from where the element is drawn.
 */

const CROSSHAIR = '[class*="crosshair-component"]';
const DURATION_MS = 240;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function number(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Where the running slide currently draws the element, relative to its place. */
function drawnOffset(element: Element): { x: number; y: number } {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return { x: 0, y: 0 };
  const matrix = new DOMMatrixReadOnly(transform);
  return { x: matrix.e, y: matrix.f };
}

export function observeCrosshairFlip(root: Element): () => void {
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slides = new WeakMap<Element, Animation>();

  const observer = new MutationObserver((records) => {
    // The crosshair reappearing at a new point shows there, without a slide.
    const appearing = records.some(
      (record) =>
        record.attributeName === "style" &&
        record.target instanceof Element &&
        record.target.matches(CROSSHAIR) &&
        /opacity:\s*0(?![.\d])/.test(record.oldValue ?? "opacity: 0"),
    );
    const jumps = new Map<Element, { x: number; y: number }>();
    for (const record of records) {
      const target = record.target;
      if (
        !(target instanceof SVGElement) ||
        record.attributeName === "style" ||
        !target.closest(CROSSHAIR)
      )
        continue;
      const before = number(record.oldValue);
      const after = number(target.getAttribute(record.attributeName ?? ""));
      if (before === undefined || after === undefined || before === after)
        continue;
      const jump = jumps.get(target) ?? { x: 0, y: 0 };
      if (record.attributeName === "cy") jump.y += before - after;
      else jump.x += before - after;
      jumps.set(target, jump);
    }
    for (const [element, jump] of jumps) {
      if (Math.abs(jump.x) < 0.5 && Math.abs(jump.y) < 0.5) continue;
      const drawn = drawnOffset(element);
      slides.get(element)?.cancel();
      if (appearing || reduceMotion || typeof element.animate !== "function")
        continue;
      slides.set(
        element,
        element.animate(
          [
            {
              transform: `translate(${drawn.x + jump.x}px, ${drawn.y + jump.y}px)`,
            },
            { transform: "translate(0, 0)" },
          ],
          { duration: DURATION_MS, easing: EASING },
        ),
      );
    }
  });
  observer.observe(root, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["x1", "cx", "cy", "style"],
  });
  return () => observer.disconnect();
}
