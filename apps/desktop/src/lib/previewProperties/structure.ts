/** Properties of archives, diagrams and mind maps. */
import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import type { ArchiveEntry } from "@/lib/archive";
import { formatBytes } from "@/lib/formatBytes";
import type { MindNode, MindSheet } from "@/lib/mindmap";
import { PropertyList } from "./propertyList";

/**
 * The comment a ZIP file keeps in its end-of-central-directory record, which
 * sits in the last 64 KB. UTF-8 when it decodes as such, else GBK, the
 * encoding old Chinese Windows tools wrote.
 */
export function zipComment(bytes: Uint8Array): string | undefined {
  // Only ZIP files (and the formats built on them) start with "PK".
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const stop = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= stop; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const length = view.getUint16(offset + 20, true);
    if (offset + 22 + length > bytes.length) continue;
    const comment = bytes.subarray(offset + 22, offset + 22 + length);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(comment);
    } catch {
      return new TextDecoder("gbk").decode(comment);
    }
  }
  return undefined;
}

export function archiveProperties(
  options: {
    entries?: readonly ArchiveEntry[];
    bytes?: ArrayBuffer;
    encrypted?: boolean;
  },
  locale: string,
): PreviewProperty[] {
  const list = new PropertyList();
  const entries = options.entries;
  if (entries) {
    const size = entries.reduce((total, entry) => total + entry.size, 0);
    list
      .number("entries", entries.length)
      .text("uncompressedSize", size ? formatBytes(size, locale) : undefined);
  }
  if (options.encrypted) list.boolean("encrypted", true);
  if (options.bytes)
    list.text("comment", zipComment(new Uint8Array(options.bytes)));
  return list.items;
}

/** What the draw.io file's root `<mxfile>` records: editor and save time. */
export function drawioProperties(source: string): PreviewProperty[] {
  const tag = /<mxfile\b[^>]*>/.exec(source.slice(0, 4_000))?.[0];
  if (!tag) return [];
  const attribute = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1];
  const version = attribute("version");
  return new PropertyList()
    .text("application", version ? `draw.io ${version}` : undefined)
    .date("documentModified", attribute("modified")).items;
}

/** An Excalidraw scene's source app, e.g. "https://excalidraw.com". */
export function excalidrawProperties(source: string): PreviewProperty[] {
  try {
    const scene = JSON.parse(source) as { source?: unknown };
    return new PropertyList().text(
      "application",
      typeof scene.source === "string"
        ? scene.source.replace(/^https?:\/\//, "").replace(/\/$/, "")
        : undefined,
    ).items;
  } catch {
    return [];
  }
}

/** A Mermaid diagram's title, from its front matter or `title` line. */
export function mermaidProperties(source: string): PreviewProperty[] {
  const head = source.slice(0, 20_000);
  const front = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1];
  const title =
    (front && /^title\s*:\s*(.+)$/m.exec(front)?.[1]) ||
    /^\s*(?:accTitle\s*:|title\s)\s*(.+)$/m.exec(
      front ? head.slice(head.indexOf("---", 3) + 3) : head,
    )?.[1];
  return new PropertyList().text(
    "title",
    title?.trim().replace(/^(["'])(.*)\1$/, "$2"),
  ).items;
}

function countTopics(node: MindNode): number {
  let count = 1;
  for (const child of node.children ?? []) count += countTopics(child);
  return count;
}

/** A mind map's central topic, topic count and sheet count. */
export function mindMapProperties(
  sheets: readonly MindSheet[],
): PreviewProperty[] {
  const first = sheets[0];
  return new PropertyList()
    .text("title", first?.root.data.text || first?.title)
    .number(
      "topics",
      sheets.reduce((total, sheet) => total + countTopics(sheet.root), 0) ||
        undefined,
    )
    .number("sheets", sheets.length > 1 ? sheets.length : undefined).items;
}

const DBF_VERSIONS: Record<number, string> = {
  0x02: "FoxBASE",
  0x03: "dBASE III",
  0x04: "dBASE IV",
  0x05: "dBASE V",
  0x30: "Visual FoxPro",
  0x31: "Visual FoxPro",
  0x83: "dBASE III",
  0x8b: "dBASE IV",
  0xf5: "FoxPro",
};

/** A DBF table's format and the last update date in its header. */
export function dbfProperties(bytes: ArrayBuffer): PreviewProperty[] {
  if (bytes.byteLength < 32) return [];
  const header = new Uint8Array(bytes, 0, 4);
  const [version, year, month, day] = header;
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= 31;
  // Years are stored since 1900; tools after 1999 differ, so small values
  // are read as this century.
  const fullYear = year < 80 ? 2000 + year : 1900 + year;
  const pad = (value: number) => String(value).padStart(2, "0");
  return new PropertyList()
    .text("version", DBF_VERSIONS[version])
    .date(
      "documentModified",
      valid ? `${fullYear}-${pad(month)}-${pad(day)}` : undefined,
    ).items;
}
