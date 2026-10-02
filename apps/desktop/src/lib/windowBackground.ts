let canvasContext: CanvasRenderingContext2D | null = null;

/**
 * Resolves the theme's `--background` (often an `oklch()` colour) to the
 * `#RRGGBB` form Electron accepts, by painting it into a 1px canvas.
 */
export function resolveThemeBackground(root: HTMLElement): string | null {
  const color = getComputedStyle(root).getPropertyValue("--background").trim();
  if (!color) return null;
  canvasContext ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!canvasContext) return null;
  canvasContext.clearRect(0, 0, 1, 1);
  canvasContext.fillStyle = color;
  canvasContext.fillRect(0, 0, 1, 1);
  const [red, green, blue] = canvasContext.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Keeps the native window background in step with the page theme. */
export function syncWindowBackground(root: HTMLElement): void {
  const setWindowBackground = window.pine?.setWindowBackground;
  if (!setWindowBackground) return;
  const color = resolveThemeBackground(root);
  if (color) void setWindowBackground(color);
}
