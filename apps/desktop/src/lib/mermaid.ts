/**
 * Renders Mermaid source to SVG with the Mermaid build file-viewer ships,
 * in strict mode: no scripts, no click handlers and sanitized labels.
 */

interface MermaidApi {
  initialize(options: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

let api: Promise<MermaidApi> | undefined;
let count = 0;

export async function renderMermaid(
  source: string,
  theme: "light" | "dark",
): Promise<string> {
  api ??= import("@file-viewer/capability-mermaid/engine").then(
    (module) => module.default,
  );
  const mermaid = await api;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: theme === "dark" ? "dark" : "neutral",
    fontFamily: getComputedStyle(document.body).fontFamily,
    // Labels as SVG text, so the diagram also renders as an image.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
  });
  const { svg } = await mermaid.render(`pine-mermaid-${++count}`, source);
  return withIntrinsicSize(svg);
}

/**
 * Mermaid sizes its SVG to the page (`width="100%"`). Shown as an image it
 * needs the size of its drawing instead.
 */
export function withIntrinsicSize(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  const [, , width, height] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number);
  if (!width || !height) return svg;
  root.setAttribute("width", String(Math.ceil(width)));
  root.setAttribute("height", String(Math.ceil(height)));
  root.style.removeProperty("max-width");
  return new XMLSerializer().serializeToString(root);
}
