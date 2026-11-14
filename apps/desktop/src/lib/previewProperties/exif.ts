/**
 * Reads the descriptive tags of a TIFF structure: an EXIF block in a JPEG,
 * PNG, WebP or HEIF file, or a TIFF file itself. Only the first image
 * directory and its EXIF directory are read; malformed entries are skipped.
 */

export interface ExifFacts {
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  description?: string;
  copyright?: string;
  title?: string;
  comment?: string;
  /** ISO 8601, from DateTimeOriginal or else DateTime. */
  taken?: string;
  /** Dots per inch, horizontal and vertical. */
  resolution?: [number, number];
  bitsPerSample?: number;
  samplesPerPixel?: number;
  photometric?: number;
}

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

/** Directories hold far fewer entries; more means the offset is wrong. */
const MAX_ENTRIES = 1000;

interface Entry {
  type: number;
  count: number;
  /** Where the value starts, inline or at its offset. */
  at: number;
}

function cleanText(text: string): string | undefined {
  const value = text
    .replace(/\u0000+$/u, "")
    .replace(/\u0000/gu, " ")
    .trim();
  return value || undefined;
}

/** EXIF "2024:05:01 14:03:22" (plus an optional "+08:00" offset) as ISO 8601. */
export function exifDate(
  value: string | undefined,
  offset?: string,
): string | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    value ?? "",
  );
  if (!match || match[1] === "0000") return undefined;
  const [, year, month, day, hour, minute, second] = match;
  const zone = /^[+-]\d{2}:\d{2}$/.test(offset ?? "") ? offset : "";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`;
}

export function readExif(
  bytes: Uint8Array,
  start = 0,
  end = bytes.byteLength,
): ExifFacts | undefined {
  if (end - start < 8) return undefined;
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + start,
    end - start,
  );
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return undefined;
  const little = order === 0x4949;
  if (view.getUint16(2, little) !== 42) return undefined;
  const length = view.byteLength;
  const utf8 = new TextDecoder();

  function entries(offset: number): Map<number, Entry> {
    const result = new Map<number, Entry>();
    if (offset < 8 || offset + 2 > length) return result;
    const count = view.getUint16(offset, little);
    if (count > MAX_ENTRIES) return result;
    for (let index = 0; index < count; index++) {
      const at = offset + 2 + index * 12;
      if (at + 12 > length) break;
      const type = view.getUint16(at + 2, little);
      const size = TYPE_SIZES[type];
      if (!size) continue;
      const valueCount = view.getUint32(at + 4, little);
      const total = size * valueCount;
      const valueAt = total <= 4 ? at + 8 : view.getUint32(at + 8, little);
      if (valueAt + total > length) continue;
      result.set(view.getUint16(at, little), {
        type,
        count: valueCount,
        at: valueAt,
      });
    }
    return result;
  }

  function bytesOf(entry: Entry): Uint8Array {
    return new Uint8Array(
      view.buffer,
      view.byteOffset + entry.at,
      entry.count * TYPE_SIZES[entry.type],
    );
  }

  function text(entry: Entry | undefined): string | undefined {
    if (!entry || (entry.type !== 2 && entry.type !== 7 && entry.type !== 1))
      return undefined;
    return cleanText(utf8.decode(bytesOf(entry)));
  }

  /** Windows' XP* tags: UTF-16LE text stored as bytes. */
  function utf16(entry: Entry | undefined): string | undefined {
    if (!entry || entry.type !== 1) return undefined;
    return cleanText(new TextDecoder("utf-16le").decode(bytesOf(entry)));
  }

  /** UserComment: an 8-byte character code, then the text. */
  function userComment(entry: Entry | undefined): string | undefined {
    if (!entry || entry.count <= 8) return undefined;
    const raw = bytesOf(entry);
    const code = String.fromCharCode(...raw.subarray(0, 8)).replace(
      /\u0000+$/u,
      "",
    );
    const body = raw.subarray(8);
    if (code === "UNICODE")
      return cleanText(
        new TextDecoder(little ? "utf-16le" : "utf-16be").decode(body),
      );
    if (code === "ASCII" || code === "") return cleanText(utf8.decode(body));
    return undefined;
  }

  function number(entry: Entry | undefined): number | undefined {
    if (!entry || entry.count < 1) return undefined;
    switch (entry.type) {
      case 1:
        return view.getUint8(entry.at);
      case 3:
        return view.getUint16(entry.at, little);
      case 4:
        return view.getUint32(entry.at, little);
      case 5: {
        const denominator = view.getUint32(entry.at + 4, little);
        return denominator
          ? view.getUint32(entry.at, little) / denominator
          : undefined;
      }
      default:
        return undefined;
    }
  }

  const main = entries(view.getUint32(4, little));
  if (!main.size) return undefined;
  const pointer = number(main.get(0x8769));
  const exif = pointer ? entries(pointer) : new Map<number, Entry>();

  const facts: ExifFacts = {
    make: text(main.get(0x010f)),
    model: text(main.get(0x0110)),
    software: text(main.get(0x0131)),
    artist: text(main.get(0x013b)) ?? utf16(main.get(0x9c9d)),
    description: text(main.get(0x010e)),
    copyright: text(main.get(0x8298)),
    title: utf16(main.get(0x9c9b)),
    comment: userComment(exif.get(0x9286)) ?? utf16(main.get(0x9c9c)),
    taken:
      exifDate(text(exif.get(0x9003)), text(exif.get(0x9011))) ??
      exifDate(text(main.get(0x0132)), text(exif.get(0x9010))),
    bitsPerSample: number(main.get(0x0102)),
    samplesPerPixel: number(main.get(0x0115)),
    photometric: number(main.get(0x0106)),
  };
  const x = number(main.get(0x011a));
  const y = number(main.get(0x011b)) ?? x;
  const unit = number(main.get(0x0128)) ?? 2;
  if (x && y && (unit === 2 || unit === 3)) {
    const scale = unit === 3 ? 2.54 : 1;
    facts.resolution = [x * scale, y * scale];
  }
  return facts;
}
