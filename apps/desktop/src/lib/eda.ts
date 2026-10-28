/**
 * Electronic design files: chip layouts (GDSII, OASIS) drawn as SVG by
 * layer, and OrCAD / Allegro libraries (OLB, DRA), which are compound files
 * whose streams and readable strings are listed.
 */
import type { EdaLayoutPreview } from "@file-viewer/eda-layout";

export async function readLayout(
  bytes: Uint8Array,
  extension: string,
): Promise<EdaLayoutPreview> {
  const { parseGdsLayout, parseOasisTextLayout } =
    await import("@file-viewer/eda-layout");
  const layout =
    extension === "gds" ? parseGdsLayout(bytes) : parseOasisTextLayout(bytes);
  if (!layout?.elements.length) throw new Error("The layout has no geometry.");
  return layout;
}

export function layoutLayers(layout: EdaLayoutPreview): number[] {
  return [
    ...new Set(
      layout.elements
        .map((element) => element.layer)
        .filter((layer): layer is number => layer !== undefined),
    ),
  ].sort((a, b) => a - b);
}

/** A stable, distinct hue for each layer number. */
export function layerColor(layer: number): string {
  return `oklch(0.66 0.15 ${(layer * 137.5 + 20) % 360})`;
}

export function renderLayout(
  layout: EdaLayoutPreview,
  hidden: ReadonlySet<number>,
  palette: { background: string; text: string },
): string {
  const visible = layout.elements.filter(
    (element) => element.layer === undefined || !hidden.has(element.layer),
  );
  const points = layout.elements.flatMap((element) => element.xy);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = 1000 / span;
  const pad = 20;
  const width = Math.ceil((maxX - minX) * scale + pad * 2);
  const height = Math.ceil((maxY - minY) * scale + pad * 2);
  // Layouts are Y-up.
  const at = (point: { x: number; y: number }) =>
    `${((point.x - minX) * scale + pad).toFixed(2)},${((maxY - point.y) * scale + pad).toFixed(2)}`;
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [];
  for (const element of visible) {
    const color =
      element.layer === undefined ? palette.text : layerColor(element.layer);
    if (element.kind === "boundary" && element.xy.length > 2)
      parts.push(
        `<polygon points="${element.xy.map(at).join(" ")}" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1"/>`,
      );
    else if (element.kind === "path" && element.xy.length > 1)
      parts.push(
        `<polyline points="${element.xy.map(at).join(" ")}" fill="none" stroke="${color}" stroke-opacity="0.8" stroke-width="${Math.max(1, (element.width ?? 0) * scale)}" stroke-linecap="square"/>`,
      );
    else if (element.kind === "text" && element.text && element.xy[0]) {
      const [x, y] = at(element.xy[0]).split(",");
      parts.push(
        `<text x="${x}" y="${y}" font-size="12" fill="${palette.text}" font-family="ui-monospace, monospace">${escape(element.text)}</text>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${palette.background}"/>${parts.join("")}</svg>`;
}

export interface OrcadContents {
  streams: [path: string, size: number][];
  strings: string[];
}

/** Lists an OrCAD or Allegro library's streams and the text inside them. */
export async function readOrcad(bytes: Uint8Array): Promise<OrcadContents> {
  const [cfb, orcad] = await Promise.all([
    import("cfb"),
    import("@file-viewer/eda-orcad"),
  ]);
  const read =
    (cfb as unknown as { default?: typeof cfb }).default?.read ?? cfb.read;
  if (!orcad.isOrcadCompoundFile(bytes))
    return { streams: [], strings: orcad.collectOrcadStrings([bytes]) };
  const container = read(bytes, { type: "array" });
  const streams: [string, number][] = [];
  const contents: Uint8Array[] = [];
  container.FileIndex.forEach((entry, index) => {
    // Type 2 entries are streams; the rest are storages and the root.
    if (entry.type !== 2) return;
    streams.push([container.FullPaths[index] ?? entry.name, entry.size]);
    if (entry.content)
      contents.push(Uint8Array.from(entry.content as ArrayLike<number>));
  });
  return { streams, strings: orcad.collectOrcadStrings(contents, 5000) };
}
