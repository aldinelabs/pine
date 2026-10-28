/**
 * Renders diagrams.net (draw.io) files to SVG without the diagrams.net
 * runtime. It covers the common vocabulary: basic shapes, swimlanes,
 * groups, styled text, images and edges with waypoints, orthogonal routing
 * and arrowheads. Every page of a file is available, compressed or not.
 */

export interface DrawioPage {
  name: string;
  model: Element;
}

type Style = Record<string, string>;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface Cell {
  id: string;
  parent?: string;
  value: string;
  style: Style;
  vertex: boolean;
  edge: boolean;
  visible: boolean;
  source?: string;
  target?: string;
  geometry?: Element;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Opens the `<mxfile>` or bare `<mxGraphModel>` a file holds. */
export async function readDrawioPages(xml: string): Promise<DrawioPage[]> {
  const parse = (text: string) => {
    const document = new DOMParser().parseFromString(text, "text/xml");
    if (document.querySelector("parsererror"))
      throw new Error("The diagram is not valid XML.");
    return document;
  };
  const document = parse(xml);
  const root = document.documentElement;
  if (root.localName === "mxGraphModel") return [{ name: "", model: root }];
  const pages: DrawioPage[] = [];
  for (const diagram of Array.from(root.getElementsByTagName("diagram"))) {
    const name = diagram.getAttribute("name") ?? "";
    let model = diagram.getElementsByTagName("mxGraphModel")[0];
    const packed = diagram.textContent?.trim();
    if (!model && packed)
      model = parse(await inflateDiagram(packed)).documentElement;
    if (model) pages.push({ name, model });
  }
  if (!pages.length) throw new Error("The diagram has no pages.");
  return pages;
}

/** Saved diagrams are deflated, Base64-encoded and URI-encoded. */
async function inflateDiagram(packed: string): Promise<string> {
  const bytes = Uint8Array.from(atob(packed), (char) => char.charCodeAt(0));
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function parseStyle(value: string | null): Style {
  const style: Style = {};
  for (const part of (value ?? "").split(";")) {
    if (!part) continue;
    const at = part.indexOf("=");
    if (at < 0) style.shape ??= part;
    else style[part.slice(0, at)] = part.slice(at + 1);
  }
  // A bare first token names the shape or a built-in style.
  if (style.shape === "text") style.shape = "text";
  return style;
}

function number(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readCells(model: Element): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const elements = Array.from(model.getElementsByTagName("mxCell"));
  // Cells wrapped in <object>/<UserObject> take their id and label from it.
  for (const element of elements) {
    const wrapper =
      element.parentElement &&
      element.parentElement.localName !== "root" &&
      element.parentElement.hasAttribute("id")
        ? element.parentElement
        : undefined;
    const id = wrapper?.getAttribute("id") ?? element.getAttribute("id");
    if (!id) continue;
    cells.set(id, {
      id,
      parent: element.getAttribute("parent") ?? undefined,
      value:
        wrapper?.getAttribute("label") ?? element.getAttribute("value") ?? "",
      style: parseStyle(element.getAttribute("style")),
      vertex: element.getAttribute("vertex") === "1",
      edge: element.getAttribute("edge") === "1",
      visible: element.getAttribute("visible") !== "0",
      source: element.getAttribute("source") ?? undefined,
      target: element.getAttribute("target") ?? undefined,
      geometry: Array.from(element.children).find(
        (child) => child.localName === "mxGeometry",
      ),
    });
  }
  return cells;
}

/** Labels are often HTML; keep their text and line breaks. */
export function labelText(value: string): string {
  if (!/[<&]/.test(value)) return value;
  const document = new DOMParser().parseFromString(
    `<body>${value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|p|li|h\d)>/gi, "\n$&")}</body>`,
    "text/html",
  );
  return (document.body.textContent ?? "").replace(/\n{2,}/g, "\n").trim();
}

let measureContext: OffscreenCanvasRenderingContext2D | null | undefined;
function measure(text: string, font: string): number {
  measureContext ??=
    typeof OffscreenCanvas === "undefined"
      ? null
      : new OffscreenCanvas(1, 1).getContext("2d");
  if (!measureContext) return text.length * 7;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

function wrap(text: string, width: number, font: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    // CJK text wraps between characters, other text between words.
    const tokens = paragraph.match(
      /[⺀-鿿가-힯＀-￯]|[^\s⺀-鿿가-힯＀-￯]+|\s+/g,
    ) ?? [""];
    let line = "";
    for (const token of tokens) {
      const next = line + token;
      if (line && measure(next.trimEnd(), font) > width) {
        lines.push(line.trimEnd());
        line = token.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

interface Builder {
  svg: SVGSVGElement;
  defs: SVGDefsElement;
  markers: Map<string, string>;
}

function element<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number | undefined>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes))
    if (value !== undefined && value !== "")
      node.setAttribute(key, String(value));
  return node;
}

function color(value: string | undefined, fallback: string): string {
  if (!value || value === "default") return fallback;
  return value;
}

function strokeAttributes(style: Style, fallback = "#000000") {
  const stroke = color(style.strokeColor, fallback);
  return {
    stroke: stroke === "none" ? "none" : stroke,
    "stroke-width": number(style.strokeWidth, 1),
    "stroke-dasharray":
      style.dashed === "1"
        ? (style.dashPattern?.replace(/\s+/g, " ") ?? "3 3")
        : undefined,
  };
}

function shapePath(shape: string, box: Box, style: Style): SVGElement {
  const { x, y, width: w, height: h } = box;
  const fill = color(style.fillColor, "#ffffff");
  const common = {
    fill: fill === "none" ? "none" : fill,
    "fill-opacity": style.fillOpacity
      ? number(style.fillOpacity) / 100
      : undefined,
    ...strokeAttributes(style),
  };
  const polygon = (points: [number, number][]) =>
    element("polygon", {
      ...common,
      points: points.map(([px, py]) => `${x + px * w},${y + py * h}`).join(" "),
    });
  switch (shape) {
    case "ellipse":
    case "doubleEllipse":
      return element("ellipse", {
        ...common,
        cx: x + w / 2,
        cy: y + h / 2,
        rx: w / 2,
        ry: h / 2,
      });
    case "rhombus":
      return polygon([
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0, 0.5],
      ]);
    case "triangle":
      return style.direction === "south"
        ? polygon([
            [0, 0],
            [1, 0],
            [0.5, 1],
          ])
        : style.direction === "north"
          ? polygon([
              [0.5, 0],
              [1, 1],
              [0, 1],
            ])
          : style.direction === "west"
            ? polygon([
                [1, 0],
                [1, 1],
                [0, 0.5],
              ])
            : polygon([
                [0, 0],
                [1, 0.5],
                [0, 1],
              ]);
    case "hexagon":
      return polygon([
        [0.25, 0],
        [0.75, 0],
        [1, 0.5],
        [0.75, 1],
        [0.25, 1],
        [0, 0.5],
      ]);
    case "parallelogram":
      return polygon([
        [0.2, 0],
        [1, 0],
        [0.8, 1],
        [0, 1],
      ]);
    case "trapezoid":
      return polygon([
        [0.2, 0],
        [0.8, 0],
        [1, 1],
        [0, 1],
      ]);
    case "cylinder":
    case "cylinder3": {
      const ry = Math.min(h * 0.15, 15);
      const group = element("g", {});
      group.append(
        element("path", {
          ...common,
          d: `M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} Z`,
        }),
        element("path", {
          ...common,
          fill: "none",
          d: `M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}`,
        }),
      );
      return group;
    }
    case "document": {
      const wave = h * 0.15;
      return element("path", {
        ...common,
        d: `M${x},${y} H${x + w} V${y + h - wave} Q${x + w * 0.75},${y + h - wave * 2} ${x + w / 2},${y + h - wave} T${x},${y + h - wave} Z`,
      });
    }
    case "cloud":
      return element("path", {
        ...common,
        d: `M${x + w * 0.25},${y + h * 0.8} C${x},${y + h * 0.8} ${x},${y + h * 0.4} ${x + w * 0.2},${y + h * 0.4} C${x + w * 0.2},${y + h * 0.05} ${x + w * 0.55},${y} ${x + w * 0.6},${y + h * 0.25} C${x + w * 0.75},${y + h * 0.05} ${x + w},${y + h * 0.2} ${x + w * 0.9},${y + h * 0.45} C${x + w},${y + h * 0.6} ${x + w * 0.95},${y + h * 0.85} ${x + w * 0.75},${y + h * 0.8} Z`,
      });
    case "actor": {
      const group = element("g", { ...common });
      group.append(
        element("ellipse", {
          cx: x + w / 2,
          cy: y + h * 0.15,
          rx: w * 0.15,
          ry: h * 0.15,
        }),
        element("path", {
          fill: "none",
          d: `M${x + w / 2},${y + h * 0.3} V${y + h * 0.65} M${x},${y + h * 0.42} H${x + w} M${x + w / 2},${y + h * 0.65} L${x},${y + h} M${x + w / 2},${y + h * 0.65} L${x + w},${y + h}`,
        }),
      );
      return group;
    }
    default: {
      // diagrams.net rounds by a share of the shorter side, or by an
      // absolute arc size.
      const radius =
        style.rounded !== "1"
          ? 0
          : style.absoluteArcSize === "1"
            ? number(style.arcSize, 20) / 2
            : (Math.min(w, h) * number(style.arcSize, 15)) / 100;
      return element("rect", {
        ...common,
        x,
        y,
        width: w,
        height: h,
        rx: radius || undefined,
      });
    }
  }
}

function fontOf(style: Style): {
  css: string;
  size: number;
  weight: string;
  italic: boolean;
  underline: boolean;
} {
  const size = number(style.fontSize, 12);
  const bits = number(style.fontStyle, 0);
  const family = style.fontFamily
    ? `${style.fontFamily}, Helvetica, Arial, sans-serif`
    : "Helvetica, Arial, sans-serif";
  return {
    css: `${bits & 2 ? "italic " : ""}${bits & 1 ? "bold " : ""}${size}px ${family}`,
    size,
    weight: bits & 1 ? "bold" : "normal",
    italic: Boolean(bits & 2),
    underline: Boolean(bits & 4),
  };
}

function appendLabel(
  target: SVGElement,
  text: string,
  box: Box,
  style: Style,
  options: { wrap: boolean; header?: number },
): void {
  if (!text || style.noLabel === "1") return;
  const font = fontOf(style);
  const spacing = number(style.spacing, 2);
  const left = box.x + spacing + number(style.spacingLeft, 0);
  const right = box.x + box.width - spacing - number(style.spacingRight, 0);
  const width = Math.max(1, right - left);
  const lines =
    options.wrap || style.whiteSpace === "wrap"
      ? wrap(text, width, font.css)
      : text.split("\n");
  const lineHeight = font.size * 1.2;
  const align = style.align ?? "center";
  const anchor =
    align === "left" ? "start" : align === "right" ? "end" : "middle";
  const x =
    align === "left" ? left : align === "right" ? right : (left + right) / 2;
  const height = options.header ?? box.height;
  const vertical = options.header
    ? "middle"
    : (style.verticalAlign ?? "middle");
  const block = lines.length * lineHeight;
  const top =
    vertical === "top"
      ? box.y + spacing
      : vertical === "bottom"
        ? box.y + height - spacing - block
        : box.y + (height - block) / 2;
  const node = element("text", {
    x,
    "text-anchor": anchor,
    fill: color(style.fontColor, "#000000"),
    "font-family": font.css.replace(/^(italic )?(bold )?\d+px /, ""),
    "font-size": font.size,
    "font-weight": font.weight,
    "font-style": font.italic ? "italic" : undefined,
    "text-decoration": font.underline ? "underline" : undefined,
  });
  lines.forEach((line, index) => {
    const span = element("tspan", {
      x,
      y: top + lineHeight * index + font.size * 0.95,
    });
    span.textContent = line;
    node.append(span);
  });
  target.append(node);
}

function marker(
  builder: Builder,
  kind: string,
  stroke: string,
  filled: boolean,
): string {
  const key = `${kind}:${stroke}:${filled}`;
  const existing = builder.markers.get(key);
  if (existing) return existing;
  const id = `m${builder.markers.size}`;
  const node = element("marker", {
    id,
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 8,
    markerHeight: 8,
    markerUnits: "userSpaceOnUse",
    orient: "auto-start-reverse",
  });
  const path =
    kind === "open"
      ? element("path", {
          d: "M1,1 L9,5 L1,9",
          fill: "none",
          stroke,
          "stroke-width": 1.5,
        })
      : kind === "oval"
        ? element("circle", {
            cx: 5,
            cy: 5,
            r: 4,
            fill: filled ? stroke : "#ffffff",
            stroke,
          })
        : kind === "diamond" || kind === "diamondThin"
          ? element("path", {
              d: "M0,5 L5,1 L10,5 L5,9 Z",
              fill: filled ? stroke : "#ffffff",
              stroke,
            })
          : element("path", {
              d:
                kind === "classic"
                  ? "M0,0 L10,5 L0,10 L3,5 Z"
                  : "M0,0 L10,5 L0,10 Z",
              fill: filled ? stroke : "#ffffff",
              stroke,
            });
  node.append(path);
  builder.defs.append(node);
  builder.markers.set(key, id);
  return id;
}

/** Where the line from a box's center towards `toward` leaves the box. */
function perimeter(box: Box, toward: Point, shape: string): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (shape === "ellipse") {
    const angle = Math.atan2(dy, dx);
    return {
      x: cx + (box.width / 2) * Math.cos(angle),
      y: cy + (box.height / 2) * Math.sin(angle),
    };
  }
  const scale = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Infinity,
    dy ? box.height / 2 / Math.abs(dy) : Infinity,
  );
  if (shape === "rhombus") {
    const k =
      1 / (Math.abs(dx) / (box.width / 2) + Math.abs(dy) / (box.height / 2));
    return { x: cx + dx * k, y: cy + dy * k };
  }
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function renderDrawioPage(page: DrawioPage): string {
  const cells = readCells(page.model);
  const absolute = new Map<string, Box>();
  const boxOf = (cell: Cell): Box | undefined => {
    const cached = absolute.get(cell.id);
    if (cached) return cached;
    const geometry = cell.geometry;
    if (!geometry || !cell.vertex) return undefined;
    let box: Box = {
      x: number(geometry.getAttribute("x")),
      y: number(geometry.getAttribute("y")),
      width: number(geometry.getAttribute("width")),
      height: number(geometry.getAttribute("height")),
    };
    // Children of shapes (groups, swimlanes) are placed relative to them.
    const parent = cell.parent ? cells.get(cell.parent) : undefined;
    const parentBox = parent ? boxOf(parent) : undefined;
    if (parentBox && geometry.getAttribute("relative") !== "1")
      box = { ...box, x: box.x + parentBox.x, y: box.y + parentBox.y };
    absolute.set(cell.id, box);
    return box;
  };
  const shown = (cell: Cell): boolean => {
    let current: Cell | undefined = cell;
    while (current) {
      if (!current.visible) return false;
      current = current.parent ? cells.get(current.parent) : undefined;
    }
    return true;
  };

  const svg = element("svg", { xmlns: SVG_NS });
  const builder: Builder = {
    svg,
    defs: element("defs", {}),
    markers: new Map(),
  };
  svg.append(builder.defs);
  const layer = element("g", {});
  svg.append(layer);
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const extend = (point: Point) => {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  };

  // Labels placed on an edge are child cells of it; draw them with the edge.
  const edgeLabels = new Map<string, string>();
  for (const cell of cells.values()) {
    const parent = cell.parent ? cells.get(cell.parent) : undefined;
    if (cell.vertex && parent?.edge && cell.value)
      edgeLabels.set(
        parent.id,
        [edgeLabels.get(parent.id), labelText(cell.value)]
          .filter(Boolean)
          .join("\n"),
      );
  }

  // Document order is drawing order in diagrams.net.
  for (const cell of cells.values()) {
    if (!shown(cell)) continue;
    const label = labelText(cell.value) || edgeLabels.get(cell.id) || "";
    if (cell.vertex) {
      if (cell.parent && cells.get(cell.parent)?.edge) continue;
      const box = boxOf(cell);
      if (!box || (!box.width && !box.height)) continue;
      extend({ x: box.x, y: box.y });
      extend({ x: box.x + box.width, y: box.y + box.height });
      const style = cell.style;
      const group = element("g", {
        opacity: style.opacity ? number(style.opacity) / 100 : undefined,
        transform: style.rotation
          ? `rotate(${number(style.rotation)} ${box.x + box.width / 2} ${box.y + box.height / 2})`
          : undefined,
      });
      const shape = style.shape ?? "rect";
      if (shape === "image" || style.image) {
        const href = style.image?.replace(
          /^data:image\/([^,;]+),/,
          "data:image/$1;base64,",
        );
        if (href?.startsWith("data:"))
          group.append(
            element("image", {
              href,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
            }),
          );
      } else if (shape === "swimlane") {
        const header = number(style.startSize, 23);
        group.append(
          shapePath("rect", box, style),
          element("line", {
            x1: box.x,
            x2: box.x + box.width,
            y1: box.y + header,
            y2: box.y + header,
            ...strokeAttributes(style),
          }),
        );
        appendLabel(
          group,
          label,
          box,
          { ...style, fontStyle: style.fontStyle ?? "1" },
          { wrap: false, header },
        );
        layer.append(group);
        continue;
      } else if (shape !== "text") group.append(shapePath(shape, box, style));
      if (shape === "label" || shape === "text" || label)
        appendLabel(group, label, box, style, {
          wrap: style.whiteSpace === "wrap",
        });
      layer.append(group);
      continue;
    }
    if (!cell.edge) continue;
    const style = cell.style;
    const geometry = cell.geometry;
    const waypoints = Array.from(
      geometry
        ?.getElementsByTagName("Array")[0]
        ?.getElementsByTagName("mxPoint") ?? [],
    ).map((point) => ({
      x: number(point.getAttribute("x")),
      y: number(point.getAttribute("y")),
    }));
    const terminal = (as: "sourcePoint" | "targetPoint") => {
      const point = Array.from(
        geometry?.getElementsByTagName("mxPoint") ?? [],
      ).find((item) => item.getAttribute("as") === as);
      return point
        ? {
            x: number(point.getAttribute("x")),
            y: number(point.getAttribute("y")),
          }
        : undefined;
    };
    const sourceCell = cell.source ? cells.get(cell.source) : undefined;
    const targetCell = cell.target ? cells.get(cell.target) : undefined;
    const sourceBox = sourceCell ? boxOf(sourceCell) : undefined;
    const targetBox = targetCell ? boxOf(targetCell) : undefined;
    const center = (box: Box) => ({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    // Waypoints of an edge inside a group are relative to that group.
    const parent = cell.parent ? cells.get(cell.parent) : undefined;
    const offset = parent ? boxOf(parent) : undefined;
    const shift = (point: Point) =>
      offset ? { x: point.x + offset.x, y: point.y + offset.y } : point;
    const middle = waypoints.map(shift);
    let start = sourceBox
      ? center(sourceBox)
      : terminal("sourcePoint") && shift(terminal("sourcePoint")!);
    let end = targetBox
      ? center(targetBox)
      : terminal("targetPoint") && shift(terminal("targetPoint")!);
    if (!start || !end) continue;
    if (
      !middle.length &&
      style.edgeStyle === "orthogonalEdgeStyle" &&
      sourceBox &&
      targetBox
    ) {
      const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
      if (Math.abs(end.x - start.x) > 1 && Math.abs(end.y - start.y) > 1)
        middle.push(
          ...(horizontal
            ? [
                { x: (start.x + end.x) / 2, y: start.y },
                { x: (start.x + end.x) / 2, y: end.y },
              ]
            : [
                { x: start.x, y: (start.y + end.y) / 2 },
                { x: end.x, y: (start.y + end.y) / 2 },
              ]),
        );
    }
    if (sourceBox)
      start = perimeter(
        sourceBox,
        middle[0] ?? end,
        sourceCell?.style.shape ?? "rect",
      );
    if (targetBox)
      end = perimeter(
        targetBox,
        middle.at(-1) ?? start,
        targetCell?.style.shape ?? "rect",
      );
    const points = [start, ...middle, end];
    points.forEach(extend);
    const stroke = color(style.strokeColor, "#000000");
    const endArrow = style.endArrow ?? "classic";
    const startArrow = style.startArrow ?? "none";
    const path = element("polyline", {
      points: points.map((point) => `${point.x},${point.y}`).join(" "),
      fill: "none",
      ...strokeAttributes(style),
      "stroke-linejoin": "round",
      "marker-end":
        endArrow !== "none"
          ? `url(#${marker(builder, endArrow, stroke, style.endFill !== "0")})`
          : undefined,
      "marker-start":
        startArrow !== "none"
          ? `url(#${marker(builder, startArrow, stroke, style.startFill !== "0")})`
          : undefined,
    });
    layer.append(path);
    if (label) {
      const mid = points[Math.floor(points.length / 2)];
      const before = points[Math.floor(points.length / 2) - 1] ?? mid;
      const at = { x: (mid.x + before.x) / 2, y: (mid.y + before.y) / 2 };
      const font = fontOf(style);
      const lines = label.split("\n");
      const width =
        Math.max(...lines.map((line) => measure(line, font.css))) + 6;
      const height = lines.length * font.size * 1.2 + 2;
      const box = { x: at.x - width / 2, y: at.y - height / 2, width, height };
      layer.append(
        element("rect", {
          ...box,
          fill: color(style.labelBackgroundColor, "#ffffff"),
        }),
      );
      appendLabel(
        layer,
        label,
        box,
        { ...style, verticalAlign: "middle", align: "center" },
        { wrap: false },
      );
    }
  }

  if (!Number.isFinite(bounds.minX))
    throw new Error("The diagram page is empty.");
  const pad = 16;
  const x = Math.floor(bounds.minX - pad);
  const y = Math.floor(bounds.minY - pad);
  const width = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
  const height = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const background = page.model.getAttribute("background");
  svg.insertBefore(
    element("rect", {
      x,
      y,
      width,
      height,
      fill: background && background !== "none" ? background : "#ffffff",
    }),
    layer,
  );
  return new XMLSerializer().serializeToString(svg);
}
