/**
 * Composites Photoshop layers onto a canvas when the reader hides or shows
 * some, approximating Photoshop with the canvas blend modes: groups,
 * opacity, blend modes and clipping masks apply; layer masks and effects do
 * not, which is why the file's own composite is shown until a layer changes.
 */
import type { BlendMode, Layer } from "ag-psd";

const BLEND: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: "source-over",
  "pass through": "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "linear dodge": "lighter",
};

export interface PsdLayerNode {
  id: string;
  name: string;
  depth: number;
  group: boolean;
  layer: Layer;
}

/** Layers top to bottom, as Photoshop's panel lists them, with stable ids. */
export function layerTree(
  layers: Layer[] | undefined,
  depth = 0,
  path = "",
): PsdLayerNode[] {
  if (!layers) return [];
  return layers
    .map((layer, index) => ({ layer, id: `${path}${index}` }))
    .reverse()
    .flatMap(({ layer, id }) => [
      {
        id,
        name: layer.name || `Layer ${id}`,
        depth,
        group: Boolean(layer.children),
        layer,
      },
      ...layerTree(layer.children, depth + 1, `${id}.`),
    ]);
}

function canvas(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  const context = new OffscreenCanvas(width, height).getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  return context;
}

function blendOf(layer: Layer): GlobalCompositeOperation {
  return (layer.blendMode && BLEND[layer.blendMode]) ?? "source-over";
}

/**
 * Draws `layers` (bottom to top, as stored) into `target`. A layer is drawn
 * when it is visible by `isVisible`; a hidden group hides its contents.
 */
export function compositeLayers(
  target: OffscreenCanvasRenderingContext2D,
  layers: Layer[] | undefined,
  isVisible: (layer: Layer) => boolean,
  opacity = 1,
): void {
  if (!layers) return;
  const { width, height } = target.canvas;
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index];
    // Clipped layers are drawn with the base layer below them.
    if (layer.clipping) continue;
    const clipped: Layer[] = [];
    for (let next = index + 1; layers[next]?.clipping; next++)
      clipped.push(layers[next]);
    if (!isVisible(layer)) continue;
    const layerOpacity = opacity * (layer.opacity ?? 1);
    if (layer.children) {
      if (layer.blendMode === "pass through") {
        compositeLayers(target, layer.children, isVisible, layerOpacity);
        continue;
      }
      const group = canvas(width, height);
      compositeLayers(group, layer.children, isVisible);
      target.globalAlpha = layerOpacity;
      target.globalCompositeOperation = blendOf(layer);
      target.drawImage(group.canvas, 0, 0);
      continue;
    }
    if (!layer.canvas) continue;
    const visibleClips = clipped.filter(
      (clip) => isVisible(clip) && clip.canvas,
    );
    let source: CanvasImageSource = layer.canvas;
    let left = layer.left ?? 0;
    let top = layer.top ?? 0;
    if (visibleClips.length) {
      const base = canvas(width, height);
      base.drawImage(layer.canvas, left, top);
      for (const clip of visibleClips) {
        base.globalAlpha = clip.opacity ?? 1;
        base.globalCompositeOperation = "source-atop";
        base.drawImage(clip.canvas!, clip.left ?? 0, clip.top ?? 0);
      }
      source = base.canvas;
      left = 0;
      top = 0;
    }
    target.globalAlpha = layerOpacity;
    target.globalCompositeOperation = blendOf(layer);
    target.drawImage(source, left, top);
  }
  target.globalAlpha = 1;
  target.globalCompositeOperation = "source-over";
}

export async function compositeToBlob(
  width: number,
  height: number,
  layers: Layer[] | undefined,
  isVisible: (layer: Layer) => boolean,
): Promise<Blob> {
  const target = canvas(width, height);
  compositeLayers(target, layers, isVisible);
  return target.canvas.convertToBlob({ type: "image/png" });
}
