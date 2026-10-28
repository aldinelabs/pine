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
