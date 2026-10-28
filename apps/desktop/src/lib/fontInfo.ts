/**
 * Reads the names and coverage of an OpenType font (TTF, OTF or WOFF) from
 * its `name`, `maxp` and `OS/2` tables. WOFF2 tables are Brotli-compressed,
 * which the browser cannot inflate by itself, so WOFF2 yields no details.
 */

export interface FontInfo {
  family?: string;
  style?: string;
  fullName?: string;
  version?: string;
  designer?: string;
  copyright?: string;
  glyphCount?: number;
  /** The font draws CJK ideographs (OS/2 Unicode range bit 59). */
  coversCjk: boolean;
}

interface TableEntry {
  offset: number;
  length: number;
  compressedLength: number;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function directory(view: DataView): Map<string, TableEntry> | undefined {
  const signature = tag(view, 0);
  const tables = new Map<string, TableEntry>();
  if (signature === "wOFF") {
    const count = view.getUint16(12);
    for (let index = 0; index < count; index++) {
      const at = 44 + index * 20;
      tables.set(tag(view, at), {
        offset: view.getUint32(at + 4),
        compressedLength: view.getUint32(at + 8),
        length: view.getUint32(at + 12),
      });
    }
    return tables;
  }
  if (
    signature !== "OTTO" &&
    signature !== "true" &&
    view.getUint32(0) !== 0x00010000
  )
    return undefined;
  const count = view.getUint16(4);
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 16;
    const length = view.getUint32(at + 12);
    tables.set(tag(view, at), {
      offset: view.getUint32(at + 8),
      length,
      compressedLength: length,
    });
  }
  return tables;
}

async function table(
  buffer: ArrayBuffer,
  entry: TableEntry | undefined,
): Promise<DataView | undefined> {
  if (!entry || entry.offset + entry.compressedLength > buffer.byteLength)
    return undefined;
  const bytes = new Uint8Array(buffer, entry.offset, entry.compressedLength);
  const data =
    entry.compressedLength < entry.length ? await inflate(bytes) : bytes;
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function readNames(view: DataView): Map<number, string> {
  const names = new Map<number, string>();
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  const utf16 = new TextDecoder("utf-16be");
  const roman = new TextDecoder("macintosh");
  for (let index = 0; index < count; index++) {
    const at = 6 + index * 12;
    if (at + 12 > view.byteLength) break;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);
    const length = view.getUint16(at + 8);
    const offset = storage + view.getUint16(at + 10);
    if (offset + length > view.byteLength) continue;
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    // Prefer Windows English names, then any Windows name, then Mac Roman.
    const windows = platform === 3 || platform === 0;
    const preferred = windows && (language === 0x409 || platform === 0);
    if (!windows && names.has(id)) continue;
    if (windows && !preferred && names.has(id)) continue;
    names.set(id, (windows ? utf16 : roman).decode(bytes).trim());
  }
  return names;
}

export async function readFontInfo(buffer: ArrayBuffer): Promise<FontInfo> {
  const info: FontInfo = { coversCjk: false };
  if (buffer.byteLength < 12) return info;
  const tables = directory(new DataView(buffer));
  if (!tables) return info;
  const [name, maxp, os2] = await Promise.all([
    table(buffer, tables.get("name")),
    table(buffer, tables.get("maxp")),
    table(buffer, tables.get("OS/2")),
  ]);
  if (name) {
    const names = readNames(name);
    info.family = names.get(16) || names.get(1);
    info.style = names.get(17) || names.get(2);
    info.fullName = names.get(4);
    info.version = names.get(5)?.replace(/^Version\s+/i, "");
    info.designer = names.get(9);
    info.copyright = names.get(0);
  }
  if (maxp && maxp.byteLength >= 6) info.glyphCount = maxp.getUint16(4);
  // ulUnicodeRange2 holds bits 32–63; bit 59 is CJK Unified Ideographs.
  if (os2 && os2.byteLength >= 50)
    info.coversCjk = Boolean(os2.getUint32(46) & (1 << (59 - 32)));
  return info;
}
