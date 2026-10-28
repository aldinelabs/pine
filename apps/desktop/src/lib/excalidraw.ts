/**
 * Renders an Excalidraw scene to SVG with Rough.js, the library Excalidraw
 * draws with, so shapes keep their hand-drawn strokes and fills. Fonts fall
 * back to local ones: hand-written text uses a casual system font.
 */

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: number;
  opacity?: number;
  seed?: number;
  isDeleted?: boolean;
  roundness?: { type: number } | null;
  points?: [number, number][];
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineHeight?: number;
  fileId?: string;
  containerId?: string | null;
}

interface Scene {
  elements?: ExcalidrawElement[];
  appState?: { viewBackgroundColor?: string };
  files?: Record<string, { dataURL?: string; mimeType?: string }>;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const FONTS: Record<number, string> = {
  1: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive',
  2: "Helvetica, Arial, sans-serif",
  3: '"Cascadia Code", Menlo, monospace',
  5: '"Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive',
  6: "Helvetica, Arial, sans-serif",
  8: '"Cascadia Code", Menlo, monospace',
};

function transparent(color: string | undefined): boolean {
  return !color || color === "transparent" || /^#[0-9a-f]{6}00$/i.test(color);
}

function bounds(element: ExcalidrawElement) {
  if (element.points?.length) {
    const xs = element.points.map(([x]) => element.x + x);
    const ys = element.points.map(([, y]) => element.y + y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }
  return {
    minX: element.x,
    minY: element.y,
    maxX: element.x + element.width,
    maxY: element.y + element.height,
  };
}

function arrowhead(
  from: [number, number],
  to: [number, number],
  size: number,
): [number, number][] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  return [
    [
      to[0] - size * Math.cos(angle - spread),
      to[1] - size * Math.sin(angle - spread),
    ],
    to,
    [
      to[0] - size * Math.cos(angle + spread),
      to[1] - size * Math.sin(angle + spread),
    ],
  ];
}

export async function renderExcalidraw(json: string): Promise<string> {
  const scene = JSON.parse(json) as Scene;
  const elements = (scene.elements ?? []).filter(
    (element) => !element.isDeleted,
  );
  if (!elements.length) throw new Error("The drawing is empty.");
  const { default: rough } = await import("roughjs");
  const svg = document.createElementNS(SVG_NS, "svg");
  const canvas = rough.svg(svg);
  const pad = 20;
  const box = elements.map(bounds).reduce(
    (all, item) => ({
      minX: Math.min(all.minX, item.minX),
      minY: Math.min(all.minY, item.minY),
      maxX: Math.max(all.maxX, item.maxX),
      maxY: Math.max(all.maxY, item.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const width = Math.ceil(box.maxX - box.minX + pad * 2);
  const height = Math.ceil(box.maxY - box.minY + pad * 2);
  const originX = box.minX - pad;
  const originY = box.minY - pad;
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${originX} ${originY} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const background = document.createElementNS(SVG_NS, "rect");
  for (const [key, value] of Object.entries({
    x: originX,
    y: originY,
    width,
    height,
    fill: scene.appState?.viewBackgroundColor ?? "#ffffff",
  }))
    background.setAttribute(key, String(value));
  svg.append(background);

  for (const element of elements) {
    const stroke = element.strokeColor ?? "#1e1e1e";
    const strokeWidth = element.strokeWidth ?? 2;
    const options = {
      seed: element.seed ?? 1,
      roughness: element.roughness ?? 1,
      stroke,
      strokeWidth,
      fill: transparent(element.backgroundColor)
        ? undefined
        : element.backgroundColor,
      fillStyle: element.fillStyle ?? "hachure",
      fillWeight: strokeWidth / 2,
      hachureGap: strokeWidth * 4,
      strokeLineDash:
        element.strokeStyle === "dashed"
          ? [8, 8 + strokeWidth]
          : element.strokeStyle === "dotted"
            ? [1.5, 6 + strokeWidth]
            : undefined,
      disableMultiStroke:
        element.strokeStyle !== "solid" && element.strokeStyle !== undefined,
      preserveVertices: (element.roughness ?? 1) < 2,
    };
    const { x, y, width: w, height: h } = element;
    let node: SVGElement | undefined;
    switch (element.type) {
      case "rectangle":
      case "frame": {
        if (element.roundness) {
          const r = Math.min(w, h) * 0.25;
          node = canvas.path(
            `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}`,
            options,
          );
        } else node = canvas.rectangle(x, y, w, h, options);
        break;
      }
      case "ellipse":
        node = canvas.ellipse(x + w / 2, y + h / 2, w, h, options);
        break;
      case "diamond":
        node = canvas.polygon(
          [
            [x + w / 2, y],
            [x + w, y + h / 2],
            [x + w / 2, y + h],
            [x, y + h / 2],
          ],
          options,
        );
        break;
      case "line":
      case "arrow":
      case "freedraw": {
        const points = (element.points ?? []).map(
          ([px, py]) => [x + px, y + py] as [number, number],
        );
        if (points.length < 2) break;
        const group = document.createElementNS(SVG_NS, "g");
        if (element.type === "freedraw")
          group.append(
            canvas.curve(points, { ...options, roughness: 0, fill: undefined }),
          );
        else
          group.append(
            canvas.linearPath(points, { ...options, fill: undefined }),
          );
        if (element.type === "arrow") {
          const size = Math.max(10, strokeWidth * 6);
          if (element.endArrowhead)
            group.append(
              canvas.linearPath(
                arrowhead(points.at(-2)!, points.at(-1)!, size),
                {
                  ...options,
                  fill: undefined,
                  strokeLineDash: undefined,
                },
              ),
            );
          if (element.startArrowhead)
            group.append(
              canvas.linearPath(arrowhead(points[1], points[0], size), {
                ...options,
                fill: undefined,
                strokeLineDash: undefined,
              }),
            );
        }
        node = group;
        break;
      }
      case "text": {
        const text = document.createElementNS(SVG_NS, "text");
        const size = element.fontSize ?? 20;
        const lineHeight = (element.lineHeight ?? 1.25) * size;
        const align = element.textAlign ?? "left";
        const anchorX =
          align === "center" ? x + w / 2 : align === "right" ? x + w : x;
        text.setAttribute(
          "font-family",
          FONTS[element.fontFamily ?? 1] ?? FONTS[1],
        );
        text.setAttribute("font-size", String(size));
        text.setAttribute("fill", stroke);
        text.setAttribute(
          "text-anchor",
          align === "center" ? "middle" : align === "right" ? "end" : "start",
        );
        (element.text ?? "").split("\n").forEach((line, index) => {
          const span = document.createElementNS(SVG_NS, "tspan");
          span.setAttribute("x", String(anchorX));
          span.setAttribute("y", String(y + lineHeight * index + size));
          span.textContent = line;
          text.append(span);
        });
        node = text;
        break;
      }
      case "image": {
        const file = element.fileId ? scene.files?.[element.fileId] : undefined;
        if (file?.dataURL?.startsWith("data:image/")) {
          const image = document.createElementNS(SVG_NS, "image");
          for (const [key, value] of Object.entries({
            href: file.dataURL,
            x,
            y,
            width: w,
            height: h,
          }))
            image.setAttribute(key, String(value));
          node = image;
        }
        break;
      }
    }
    if (!node) continue;
    if (element.opacity !== undefined && element.opacity < 100)
      node.setAttribute("opacity", String(element.opacity / 100));
    if (element.angle)
      node.setAttribute(
        "transform",
        `rotate(${(element.angle * 180) / Math.PI} ${x + w / 2} ${y + h / 2})`,
      );
    svg.append(node);
  }
  return new XMLSerializer().serializeToString(svg);
}
