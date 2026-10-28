/**
 * Resolves Pine's color tokens to concrete colors, for drawings that cannot
 * read CSS variables, such as an SVG shown as an image or a canvas.
 */
export function resolveColors<T extends string>(
  tokens: Record<T, string>,
  root: Element = document.body,
): Record<T, string> {
  const probe = document.createElement("span");
  probe.style.display = "none";
  root.append(probe);
  try {
    const resolved = {} as Record<T, string>;
    for (const [key, token] of Object.entries(tokens) as [T, string][]) {
      probe.style.color = `var(${token})`;
      resolved[key] = getComputedStyle(probe).color;
    }
    return resolved;
  } finally {
    probe.remove();
  }
}

/** A resolved CSS color as `#rrggbb`, for renderers that parse only hex. */
export function toHex(color: string): string {
  const context =
    typeof OffscreenCanvas === "undefined"
      ? null
      : new OffscreenCanvas(1, 1).getContext("2d", {
          willReadFrequently: true,
        });
  if (!context) return color;
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
