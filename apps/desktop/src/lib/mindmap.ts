/**
 * Lays out XMind maps as SVG. Files are read with JSZip (the parser's own
 * ZIP reader cannot follow entries whose sizes trail their data) and turned
 * into KityMinder trees by xmind-parser; the map is drawn with the root in
 * the middle and its branches split to the right and left.
 */

export interface MindNode {
  data: {
    text?: string;
    note?: string;
    label?: string[];
    priority?: number;
    progress?: number;
    image?: string;
    imageSize?: { width?: number; height?: number };
    hyperlink?: string;
    expandState?: string;
  };
  children?: MindNode[];
}

export interface MindSheet {
  title?: string;
  root: MindNode;
}

export async function readMindMap(buffer: ArrayBuffer): Promise<MindSheet[]> {
  const [{ default: JSZip }, parser] = await Promise.all([
    import("jszip"),
    import("@ljheee/xmind-parser"),
  ]);
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) => {
    const entry = Object.values(zip.files).find(
      (file) => file.name.toLowerCase() === name,
    );
    return entry ? entry.async("string") : undefined;
  };
  const resources: Record<string, Uint8Array> = {};
  for (const file of Object.values(zip.files))
    if (
      !file.dir &&
      (file.name.startsWith("resources/") ||
        file.name.startsWith("attachments/"))
    )
      resources[file.name] = await file.async("uint8array");
  const options = {
    resources: Object.keys(resources).length ? resources : null,
  };
  const json = await read("content.json");
  if (json) return parser.parseXmind2020Json(json, options) as MindSheet[];
  const xml = await read("content.xml");
  if (xml)
    return parser.parseXmind8Xml(xml, {
      ...options,
      commentsXml: await read("comments.xml"),
    }) as MindSheet[];
  throw new Error("The mind map has no content.");
}

export interface MindPalette {
  background: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  font: string;
}

interface Placed {
  node: MindNode;
  depth: number;
  side: 1 | -1;
  lines: string[];
  width: number;
  height: number;
  fontSize: number;
  image?: { href: string; width: number; height: number };
  x: number;
  y: number;
  children: Placed[];
  hidden: number;
}

const GAP_X = 44;
const GAP_Y = 14;
const MAX_TEXT = 260;

let context: OffscreenCanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string): number {
  context ??=
    typeof OffscreenCanvas === "undefined"
      ? null
      : new OffscreenCanvas(1, 1).getContext("2d");
  if (!context) return text.length * 8;
  context.font = font;
  return context.measureText(text).width;
}

function wrapText(text: string, font: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const char of paragraph) {
      if (line && textWidth(line + char, font) > MAX_TEXT) {
        // Break at the last space for words, anywhere for CJK.
        const space = line.lastIndexOf(" ");
        if (space > 0 && !/[⺀-鿿]/.test(char)) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1) + char;
        } else {
          lines.push(line);
          line = char;
        }
      } else line += char;
    }
    lines.push(line);
  }
  return lines;
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function measureNode(
  node: MindNode,
  depth: number,
  side: 1 | -1,
  palette: MindPalette,
): Placed {
  const fontSize = depth === 0 ? 20 : depth === 1 ? 15 : 13;
  const weight = depth <= 1 ? 600 : 400;
  const font = `${weight} ${fontSize}px ${palette.font}`;
  const lines = wrapText(node.data.text?.trim() || " ", font);
  const textW = Math.max(...lines.map((line) => textWidth(line, font)));
  const lineHeight = fontSize * 1.35;
  const padX = depth === 0 ? 20 : depth === 1 ? 14 : 6;
  const padY = depth === 0 ? 12 : depth === 1 ? 8 : 4;
  let image: Placed["image"];
  if (node.data.image?.startsWith("data:image/")) {
    const ratio =
      (node.data.imageSize?.height ?? 120) /
      (node.data.imageSize?.width ?? 160);
    const width = Math.min(node.data.imageSize?.width ?? 160, 220);
    image = { href: node.data.image, width, height: width * ratio };
  }
  const extras = (node.data.label?.length ? 1 : 0) * (fontSize * 1.2);
  const badges = (node.data.priority ? 1 : 0) + (node.data.note ? 1 : 0);
  const width =
    Math.max(textW + badges * (fontSize + 4), image?.width ?? 0) + padX * 2;
  const height =
    lines.length * lineHeight +
    padY * 2 +
    (image ? image.height + 6 : 0) +
    extras;
  const collapsed = node.data.expandState === "collapse";
  const children = collapsed
    ? []
    : (node.children ?? []).map((child) =>
        measureNode(child, depth + 1, side, palette),
      );
  return {
    node,
    depth,
    side,
    lines,
    width,
    height,
    fontSize,
    image,
    x: 0,
    y: 0,
    children,
    hidden: collapsed ? (node.children?.length ?? 0) : 0,
  };
}

function subtreeHeight(placed: Placed): number {
  if (!placed.children.length) return placed.height;
  const children =
    placed.children.reduce((sum, child) => sum + subtreeHeight(child), 0) +
    GAP_Y * (placed.children.length - 1);
  return Math.max(placed.height, children);
}

/** Places a branch to one side, `x` being the edge nearest the root. */
function place(placed: Placed, x: number, top: number): void {
  const total = subtreeHeight(placed);
  placed.y = top + (total - placed.height) / 2;
  placed.x = placed.side === 1 ? x : x - placed.width;
  const childrenHeight =
    placed.children.reduce((sum, child) => sum + subtreeHeight(child), 0) +
    GAP_Y * Math.max(0, placed.children.length - 1);
  let y = top + (total - childrenHeight) / 2;
  const next =
    placed.side === 1 ? placed.x + placed.width + GAP_X : placed.x - GAP_X;
  for (const child of placed.children) {
    place(child, next, y);
    y += subtreeHeight(child) + GAP_Y;
  }
}

export function renderMindMap(sheet: MindSheet, palette: MindPalette): string {
  const root = measureNode(sheet.root, 0, 1, palette);
  // Branches alternate sides by size, as XMind's map structure does.
  const right: Placed[] = [];
  const left: Placed[] = [];
  let rightHeight = 0;
  let leftHeight = 0;
  for (const child of root.children) {
    const height = subtreeHeight(child);
    if (rightHeight <= leftHeight) {
      right.push(child);
      rightHeight += height + GAP_Y;
    } else {
      left.push(child);
      leftHeight += height + GAP_Y;
      const flip = (item: Placed): void => {
        item.side = -1;
        item.children.forEach(flip);
      };
      flip(child);
    }
  }
  root.x = 0;
  root.y = 0;
  const layout = (branches: Placed[], side: 1 | -1, total: number) => {
    let y = root.height / 2 - total / 2;
    const x = side === 1 ? root.width + GAP_X : -GAP_X;
    for (const branch of branches) {
      place(branch, x, y);
      y += subtreeHeight(branch) + GAP_Y;
    }
  };
  layout(right, 1, rightHeight - GAP_Y);
  layout(left, -1, leftHeight - GAP_Y);

  const all: Placed[] = [];
  const collect = (item: Placed) => {
    all.push(item);
    item.children.forEach(collect);
  };
  collect(root);
  const minX = Math.min(...all.map((item) => item.x)) - 24;
  const minY = Math.min(...all.map((item) => item.y)) - 24;
  const maxX = Math.max(...all.map((item) => item.x + item.width)) + 24;
  const maxY = Math.max(...all.map((item) => item.y + item.height)) + 24;

  const parts: string[] = [];
  const line = (from: Placed, to: Placed) => {
    const startX = to.side === 1 ? from.x + from.width : from.x;
    const startY = from.y + from.height / 2;
    const endX = to.side === 1 ? to.x : to.x + to.width;
    const endY = to.depth >= 2 ? to.y + to.height : to.y + to.height / 2;
    const midX = (startX + endX) / 2;
    parts.push(
      `<path d="M${startX},${startY} C${midX},${startY} ${midX},${endY} ${endX},${endY}" fill="none" stroke="${palette.mutedForeground}" stroke-opacity="0.55" stroke-width="${to.depth === 1 ? 2 : 1.25}"/>`,
    );
  };
  const draw = (item: Placed) => {
    for (const child of item.children) line(item, child);
    const { x, y, width, height, depth, fontSize } = item;
    const fill =
      depth === 0 ? palette.primary : depth === 1 ? palette.muted : "none";
    const color = depth === 0 ? palette.primaryForeground : palette.foreground;
    if (depth <= 1)
      parts.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${depth === 0 ? 12 : 9}" fill="${fill}"/>`,
      );
    else
      parts.push(
        `<line x1="${x}" x2="${x + width}" y1="${y + height}" y2="${y + height}" stroke="${palette.mutedForeground}" stroke-opacity="0.55" stroke-width="1.25"/>`,
      );
    const padX = depth === 0 ? 20 : depth === 1 ? 14 : 6;
    let cursor = y + (depth === 0 ? 12 : depth === 1 ? 8 : 4);
    if (item.image) {
      parts.push(
        `<image href="${escape(item.image.href)}" x="${x + (width - item.image.width) / 2}" y="${cursor}" width="${item.image.width}" height="${item.image.height}"/>`,
      );
      cursor += item.image.height + 6;
    }
    let textX = x + padX;
    const badge = (glyph: string, background: string, foreground: string) => {
      const r = fontSize * 0.5;
      parts.push(
        `<circle cx="${textX + r}" cy="${cursor + fontSize * 0.68}" r="${r}" fill="${background}"/><text x="${textX + r}" y="${cursor + fontSize * 0.68 + fontSize * 0.3}" font-size="${fontSize * 0.75}" text-anchor="middle" fill="${foreground}" font-family="${escape(palette.font)}" font-weight="600">${glyph}</text>`,
      );
      textX += fontSize + 4;
    };
    if (item.node.data.priority)
      badge(
        String(item.node.data.priority),
        palette.foreground,
        palette.background,
      );
    if (item.node.data.note) badge("≡", palette.border, palette.foreground);
    item.lines.forEach((text, index) => {
      parts.push(
        `<text x="${textX}" y="${cursor + fontSize * 1.35 * index + fontSize}" font-size="${fontSize}" font-weight="${depth <= 1 ? 600 : 400}" fill="${color}" font-family="${escape(palette.font)}">${escape(text)}</text>`,
      );
    });
    cursor += item.lines.length * fontSize * 1.35;
    if (item.node.data.label?.length)
      parts.push(
        `<text x="${textX}" y="${cursor + fontSize}" font-size="${fontSize * 0.8}" fill="${depth === 0 ? palette.primaryForeground : palette.mutedForeground}" font-family="${escape(palette.font)}">${escape(item.node.data.label.join(" · "))}</text>`,
      );
    if (item.hidden) {
      const cx = item.side === 1 ? x + width + 12 : x - 12;
      parts.push(
        `<circle cx="${cx}" cy="${y + height / 2}" r="9" fill="${palette.background}" stroke="${palette.mutedForeground}"/><text x="${cx}" y="${y + height / 2 + 3.5}" font-size="10" text-anchor="middle" fill="${palette.mutedForeground}" font-family="${escape(palette.font)}">${item.hidden}</text>`,
      );
    }
    item.children.forEach(draw);
  };
  draw(root);
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${palette.background}"/>${parts.join("")}</svg>`;
}
