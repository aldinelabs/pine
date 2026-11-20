/**
 * Holds a document viewer at the width it last settled at while its frame
 * resizes, and scales it to fit instead.
 *
 * The PDF renderer fits pages to width on every size change, and each fit
 * drops and redraws every visible page canvas and text layer. Dragging the
 * workbench edge changes the width every frame, so the redraws pile up and
 * the drag stutters. Scaling the drawn pages costs the compositor nothing;
 * the viewer takes the new size once the frame stops changing, which fits
 * the pages once and swaps the new drawing in over the scaled old one.
 *
 * Height changes are held too: the renderer restyles its whole page tree and
 * rebuilds its page list on any size change, which in Pine's stylesheet costs
 * a frame of its own. The held height only grows, in steps with room to
 * spare, and the frame clips what it does not show.
 */

/** How long the frame keeps one width before the viewer takes it. */
export const RESIZE_SETTLE_MS = 150;

/** Sizes closer than this count as the same; layout rounds subpixels. */
const SAME_SIZE_EPSILON = 0.5;

/** How far past the needed height a held viewer grows, so it grows rarely. */
const HEIGHT_HEADROOM = 1.5;

export interface Size {
  width: number;
  height: number;
}

/** The viewer's layout while held, or `null` to fill the frame again. */
export interface HeldLayout {
  width: number;
  height: number;
  scale: number;
}

export interface ResizeHoldOptions {
  /** Applies a held layout, or `null` once the viewer takes the frame. */
  apply: (layout: HeldLayout | null) => void;
  settleMs?: number;
}

export interface ResizeHold {
  /** Reports the frame's current size. */
  resize: (size: Size) => void;
  /** Lets the viewer take the frame's size now. */
  release: () => void;
  dispose: () => void;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_SIZE_EPSILON;
}

/** The size-tracking logic, free of the DOM so it can be tested alone. */
export function createResizeHold(
  initial: Size,
  { apply, settleMs = RESIZE_SETTLE_MS }: ResizeHoldOptions,
): ResizeHold {
  /** The size the viewer last laid its pages out at. */
  let settled = initial;
  let current = initial;
  /** The height the viewer is laid out at while held. */
  let heldHeight = 0;
  let held = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function release(): void {
    clearTimeout(timer);
    timer = undefined;
    settled = current;
    if (!held) return;
    held = false;
    apply(null);
  }

  function resize(size: Size): void {
    current = size;
    // A hidden frame, or one never measured, has nothing to scale from.
    if (
      size.width <= 0 ||
      size.height <= 0 ||
      settled.width <= 0 ||
      settled.height <= 0
    ) {
      release();
      return;
    }
    if (
      !held &&
      same(size.width, settled.width) &&
      same(size.height, settled.height)
    )
      return;
    if (!held) heldHeight = settled.height;
    held = true;
    const scale = size.width / settled.width;
    const needed = size.height / scale;
    if (needed > heldHeight + SAME_SIZE_EPSILON)
      heldHeight = needed * HEIGHT_HEADROOM;
    apply({ width: settled.width, height: heldHeight, scale });
    clearTimeout(timer);
    timer = setTimeout(release, settleMs);
  }

  return {
    resize,
    release,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Holds `viewer`, absolutely positioned to fill `frame`, at its settled size
 * while `frame` resizes; `frame` must clip it. Returns a function that stops
 * holding.
 */
export function holdViewerDuringResize(
  frame: HTMLElement,
  viewer: HTMLElement,
  settleMs = RESIZE_SETTLE_MS,
): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  const style = viewer.style;
  const hold = createResizeHold(
    { width: frame.clientWidth, height: frame.clientHeight },
    {
      settleMs,
      apply(layout) {
        if (!layout) {
          style.removeProperty("right");
          style.removeProperty("bottom");
          style.removeProperty("width");
          style.removeProperty("height");
          style.removeProperty("transform");
          style.removeProperty("transform-origin");
          return;
        }
        style.right = "auto";
        style.bottom = "auto";
        style.width = `${layout.width}px`;
        style.height = `${layout.height}px`;
        style.transformOrigin = "0 0";
        style.transform = `scale(${layout.scale})`;
      },
    },
  );
  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    hold.resize({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    });
  });
  observer.observe(frame);
  return () => {
    observer.disconnect();
    hold.release();
    hold.dispose();
  };
}
