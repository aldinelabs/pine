/**
 * The metadata an image file records about itself (camera, date, color
 * mode, resolution, frames, embedded text), read from its header and
 * metadata blocks without decoding pixels. Truncated input yields what the
 * available bytes hold.
 */
import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { readExif, type ExifFacts } from "./exif";
import { PropertyList } from "./propertyList";

export interface ImageFacts {
  title?: string;
  author?: string;
  camera?: string;
  taken?: string;
  frames?: number;
  colorMode?: string;
  bitDepth?: number;
  /** Dots per inch, horizontal and vertical. */
  resolution?: [number, number];
  application?: string;
  comment?: string;
}

/** Bytes read for metadata; EXIF and PNG text chunks sit near the start. */
export const IMAGE_HEAD_BYTES = 512 * 1024;
/** Animated GIF and WebP are read whole to count frames, up to this size. */
export const IMAGE_FRAME_SCAN_BYTES = 64 * 1024 * 1024;

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder();

function camera(make?: string, model?: string): string | undefined {
  if (!model) return make;
  if (!make) return model;
  const brand = make.split(/\s+/)[0].toLowerCase();
  return model.toLowerCase().startsWith(brand) ? model : `${make} ${model}`;
}

function fromExif(facts: ImageFacts, exif: ExifFacts | undefined): void {
  if (!exif) return;
  facts.title ??= exif.title ?? exif.description;
  facts.author ??= exif.artist;
  facts.camera ??= camera(exif.make, exif.model);
  facts.taken ??= exif.taken;
  facts.application ??= exif.software;
  facts.comment ??= exif.comment;
  facts.resolution ??= exif.resolution;
}

/** Reads the few XMP fields Details shows from an XMP packet. */
export function readXmp(packet: string, facts: ImageFacts): void {
  const field = (name: string): string | undefined => {
    const attribute = new RegExp(`${name}="([^"]*)"`).exec(packet);
    if (attribute) return decodeEntities(attribute[1]);
    const element = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(
      packet,
    );
    if (!element) return undefined;
    const item = /<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/.exec(element[1]);
    return decodeEntities((item ? item[1] : element[1]).trim());
  };
  facts.title ??= field("dc:title") || undefined;
  facts.author ??= field("dc:creator") || undefined;
  facts.application ??= field("xmp:CreatorTool") || undefined;
  facts.comment ??= field("dc:description") || undefined;
  const created = field("photoshop:DateCreated") ?? field("xmp:CreateDate");
  if (created && !Number.isNaN(Date.parse(created))) facts.taken ??= created;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&amp;/g, "&");
}

function xmpAt(bytes: Uint8Array, start: number, end: number): string {
  return utf8.decode(bytes.subarray(start, end));
}

const JPEG_COMPONENTS: Record<number, string> = {
  1: "Grayscale",
  3: "RGB",
  4: "CMYK",
};
const XMP_SIGNATURE = "http://ns.adobe.com/xap/1.0/\0";

function readJpeg(bytes: Uint8Array, facts: ImageFacts): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let jfif: [number, number] | undefined;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = view.getUint16(offset + 2);
    const start = offset + 4;
    const end = Math.min(offset + 2 + length, bytes.byteLength);
    if (marker === 0xe1 && ascii(bytes, start, 6) === "Exif\0\0")
      fromExif(facts, readExif(bytes, start + 6, end));
    else if (
      marker === 0xe1 &&
      ascii(bytes, start, XMP_SIGNATURE.length) === XMP_SIGNATURE
    )
      readXmp(xmpAt(bytes, start + XMP_SIGNATURE.length, end), facts);
    else if (marker === 0xe0 && ascii(bytes, start, 5) === "JFIF\0") {
      const unit = bytes[start + 7];
      const x = view.getUint16(start + 8);
      const y = view.getUint16(start + 10);
      if (x && y && (unit === 1 || unit === 2))
        jfif = unit === 2 ? [x * 2.54, y * 2.54] : [x, y];
    } else if (marker === 0xfe)
      facts.comment ??= cleanText(utf8.decode(bytes.subarray(start, end)));
    else if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc &&
      end - start >= 6
    ) {
      facts.bitDepth = bytes[start];
      facts.colorMode = JPEG_COMPONENTS[bytes[start + 5]];
    }
    offset = offset + 2 + length;
  }
  // EXIF resolution wins; JFIF's 1:1 aspect ratio placeholder has no unit.
  facts.resolution ??= jfif;
}

const PNG_COLOR_TYPES: Record<number, string> = {
  0: "Grayscale",
  2: "RGB",
  3: "Indexed",
  4: "Grayscale + alpha",
  6: "RGBA",
};

/** tEXt / iTXt keywords and the facts they fill. */
function pngText(facts: ImageFacts, keyword: string, value: string): void {
  const text = cleanText(value);
  if (!text) return;
  switch (keyword.toLowerCase()) {
    case "title":
      facts.title ??= text;
      break;
    case "author":
      facts.author ??= text;
      break;
    case "software":
      facts.application ??= text;
      break;
    case "comment":
    case "description":
      facts.comment ??= text;
      break;
    case "creation time": {
      if (!Number.isNaN(Date.parse(text)))
        facts.taken ??= new Date(text).toISOString();
      break;
    }
    case "xml:com.adobe.xmp":
      readXmp(text, facts);
      break;
  }
}

function readPng(bytes: Uint8Array, facts: ImageFacts): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.byteLength || type === "IEND") break;
    if (type === "IHDR" && length >= 13) {
      facts.bitDepth = bytes[start + 8];
      facts.colorMode = PNG_COLOR_TYPES[bytes[start + 9]];
    } else if (type === "pHYs" && length >= 9 && bytes[start + 8] === 1) {
      // Pixels per metre.
      facts.resolution = [
        view.getUint32(start) * 0.0254,
        view.getUint32(start + 4) * 0.0254,
      ];
    } else if (type === "acTL" && length >= 8) {
      facts.frames = view.getUint32(start);
    } else if (type === "eXIf") {
      fromExif(facts, readExif(bytes, start, end));
    } else if (type === "tEXt") {
      const chunk = bytes.subarray(start, end);
      const split = chunk.indexOf(0);
      if (split > 0)
        pngText(
          facts,
          latin1.decode(chunk.subarray(0, split)),
          latin1.decode(chunk.subarray(split + 1)),
        );
    } else if (type === "iTXt") {
      const chunk = bytes.subarray(start, end);
      const split = chunk.indexOf(0);
      // Compressed iTXt needs inflating; it is rare for these keywords.
      if (split > 0 && chunk[split + 1] === 0) {
        let at = split + 3;
        at = chunk.indexOf(0, at) + 1; // language tag
        at = at && chunk.indexOf(0, at) + 1; // translated keyword
        if (at > 0)
          pngText(
            facts,
            latin1.decode(chunk.subarray(0, split)),
            utf8.decode(chunk.subarray(at)),
          );
      }
    }
    offset = end + 4;
  }
}

/** Walks a GIF's blocks; frames are counted only when the file is complete. */
function readGif(bytes: Uint8Array, facts: ImageFacts): void {
  if (bytes.byteLength < 13) return;
  facts.colorMode = "Indexed";
  const packed = bytes[10];
  facts.bitDepth = ((packed >> 4) & 7) + 1;
  let offset = 13;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 7) + 1);
  let frames = 0;
  const skipSubBlocks = (at: number): number => {
    while (at < bytes.byteLength && bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  while (offset < bytes.byteLength) {
    const block = bytes[offset];
    if (block === 0x3b) {
      if (frames > 1) facts.frames = frames;
      return;
    }
    if (block === 0x21) {
      const label = bytes[offset + 1];
      if (label === 0xfe) {
        const parts: number[] = [];
        let at = offset + 2;
        while (at < bytes.byteLength && bytes[at] !== 0) {
          parts.push(...bytes.subarray(at + 1, at + 1 + bytes[at]));
          at += bytes[at] + 1;
        }
        facts.comment ??= cleanText(latin1.decode(new Uint8Array(parts)));
      }
      offset = skipSubBlocks(offset + 2);
    } else if (block === 0x2c) {
      frames++;
      const local = bytes[offset + 9];
      offset += 10;
      if (local & 0x80) offset += 3 * 2 ** ((local & 7) + 1);
      offset = skipSubBlocks(offset + 1);
    } else return;
  }
}

function readWebp(bytes: Uint8Array, facts: ImageFacts): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let frames = 0;
  let animated = false;
  let complete = false;
  facts.bitDepth = 8;
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (type === "VP8X" && length >= 1) {
      animated = Boolean(bytes[start] & 0x02);
      facts.colorMode = bytes[start] & 0x10 ? "RGBA" : "RGB";
    } else if (type === "VP8L" && length >= 5) {
      facts.colorMode ??=
        (view.getUint32(start + 1, true) >> 28) & 1 ? "RGBA" : "RGB";
    } else if (type === "VP8 ") facts.colorMode ??= "RGB";
    else if (type === "ANMF") frames++;
    else if (type === "EXIF" && end <= bytes.byteLength) {
      const exifStart = ascii(bytes, start, 6) === "Exif\0\0" ? 6 : 0;
      fromExif(facts, readExif(bytes, start + exifStart, end));
    } else if (type === "XMP " && end <= bytes.byteLength)
      readXmp(xmpAt(bytes, start, end), facts);
    offset = end + (length % 2);
    if (offset === bytes.byteLength) complete = true;
  }
  if (animated && complete && frames > 1) facts.frames = frames;
}

const TIFF_PHOTOMETRIC: Record<number, string> = {
  0: "Grayscale",
  1: "Grayscale",
  2: "RGB",
  3: "Indexed",
  5: "CMYK",
  6: "RGB",
  8: "Lab",
};

function readTiff(bytes: Uint8Array, facts: ImageFacts): void {
  const exif = readExif(bytes);
  fromExif(facts, exif);
  if (!exif) return;
  facts.bitDepth = exif.bitsPerSample;
  const mode =
    exif.photometric === undefined
      ? undefined
      : TIFF_PHOTOMETRIC[exif.photometric];
  const extra =
    (exif.samplesPerPixel ?? 0) -
    (mode === "CMYK" ? 4 : mode === "RGB" || mode === "Lab" ? 3 : 1);
  facts.colorMode =
    mode === "RGB" && extra > 0
      ? "RGBA"
      : mode === "Grayscale" && extra > 0
        ? "Grayscale + alpha"
        : mode;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

function boxes(view: DataView, start: number, end: number): Box[] {
  const result: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) break;
    result.push({
      type: String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      ),
      start: offset + header,
      end: offset + size,
    });
    offset += size;
  }
  return result;
}

/** Where a HEIF/AVIF file stores its EXIF item, from `meta`'s iinf and iloc. */
export function heifExifRange(
  bytes: Uint8Array,
): [start: number, end: number] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = boxes(view, 0, bytes.byteLength).find(
    (box) => box.type === "meta",
  );
  if (!meta) return undefined;
  const children = boxes(view, meta.start + 4, meta.end);
  const iinf = children.find((box) => box.type === "iinf");
  const iloc = children.find((box) => box.type === "iloc");
  if (!iinf || !iloc) return undefined;
  let exifId: number | undefined;
  const entriesAt = iinf.start + 4 + (view.getUint8(iinf.start) ? 4 : 2);
  for (const infe of boxes(view, entriesAt, iinf.end)) {
    if (infe.type !== "infe") continue;
    const version = view.getUint8(infe.start);
    if (version < 2) continue;
    const id =
      version === 2
        ? view.getUint16(infe.start + 4)
        : view.getUint32(infe.start + 4);
    const typeAt = infe.start + 4 + (version === 2 ? 2 : 4) + 2;
    if (ascii(bytes, typeAt, 4) === "Exif") {
      exifId = id;
      break;
    }
  }
  if (exifId === undefined) return undefined;
  const version = view.getUint8(iloc.start);
  const sizes = view.getUint8(iloc.start + 4);
  const more = view.getUint8(iloc.start + 5);
  const [offsetSize, lengthSize, baseSize] = [
    sizes >> 4,
    sizes & 15,
    more >> 4,
  ];
  const indexSize = version > 0 ? more & 15 : 0;
  let at = iloc.start + 6;
  const read = (size: number): number => {
    const value =
      size === 8
        ? Number(view.getBigUint64(at))
        : size === 4
          ? view.getUint32(at)
          : size === 2
            ? view.getUint16(at)
            : 0;
    at += size;
    return value;
  };
  const count = read(version < 2 ? 2 : 4);
  for (let item = 0; item < count && at < iloc.end; item++) {
    const id = read(version < 2 ? 2 : 4);
    const method = version > 0 ? read(2) & 15 : 0;
    read(2); // data reference index
    const base = read(baseSize);
    const extents = read(2);
    let first: [number, number] | undefined;
    for (let extent = 0; extent < extents; extent++) {
      read(indexSize);
      const offset = read(offsetSize);
      const length = read(lengthSize);
      first ??= [base + offset, length];
    }
    if (id !== exifId) continue;
    // Only items stored in the file itself (construction method 0).
    if (!first || method !== 0) return undefined;
    const [start, length] = first;
    const end = length ? start + length : bytes.byteLength;
    return end <= bytes.byteLength ? [start, end] : undefined;
  }
  return undefined;
}

function readHeif(bytes: Uint8Array, facts: ImageFacts): void {
  const range = heifExifRange(bytes);
  if (!range || range[1] - range[0] < 4) return;
  // The item starts with the offset of the TIFF header ("Exif\0\0" before it).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tiff = range[0] + 4 + view.getUint32(range[0]);
  fromExif(facts, readExif(bytes, tiff, range[1]));
}

function readBmp(bytes: Uint8Array, facts: ImageFacts): void {
  if (bytes.byteLength < 46) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bits = view.getUint16(28, true);
  facts.colorMode = bits <= 8 ? "Indexed" : bits === 32 ? "RGBA" : "RGB";
  facts.bitDepth = bits <= 8 ? bits : 8;
  const x = view.getInt32(38, true);
  const y = view.getInt32(42, true);
  if (x > 0 && y > 0) facts.resolution = [x * 0.0254, y * 0.0254];
}

/** The facts an SVG states: its title, description and editor. */
export function readSvgFacts(text: string): ImageFacts {
  const facts: ImageFacts = {};
  const head = text.slice(0, IMAGE_HEAD_BYTES);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (title) facts.title = cleanText(decodeEntities(title[1]));
  const description = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(head);
  if (description) facts.comment = cleanText(decodeEntities(description[1]));
  const inkscape = /inkscape:version="([^"\s]+)/.exec(head);
  if (inkscape) facts.application = `Inkscape ${inkscape[1]}`;
  else {
    const generator = /<!--\s*Generator:\s*([^-]+?)\s*(?:-->|,)/i.exec(head);
    if (generator) facts.application = generator[1].trim();
  }
  readXmp(head, facts);
  return facts;
}

function cleanText(text: string): string | undefined {
  const value = text.replace(/\u0000/g, " ").trim();
  return value || undefined;
}

/** Reads the facts the image's own bytes record, by its file signature. */
export function readImageFacts(bytes: Uint8Array): ImageFacts {
  const facts: ImageFacts = {};
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) readJpeg(bytes, facts);
    else if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") readPng(bytes, facts);
    else if (ascii(bytes, 0, 4) === "GIF8") readGif(bytes, facts);
    else if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
      readWebp(bytes, facts);
    else if (["II*\0", "MM\0*"].includes(ascii(bytes, 0, 4)))
      readTiff(bytes, facts);
    else if (ascii(bytes, 0, 2) === "BM") readBmp(bytes, facts);
    else if (ascii(bytes, 4, 4) === "ftyp") readHeif(bytes, facts);
  } catch {
    // Keep what was read before the malformed part.
  }
  return facts;
}

/** Whether the format needs the whole file to count its frames. */
export function needsWholeImage(bytes: Uint8Array): boolean {
  return (
    ascii(bytes, 0, 4) === "GIF8" ||
    (ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 4) === "WEBP" &&
      ascii(bytes, 12, 4) === "VP8X" &&
      Boolean(bytes[20] & 0x02))
  );
}

function dpi([x, y]: [number, number]): string {
  const [rx, ry] = [Math.round(x), Math.round(y)];
  return rx === ry ? `${rx} dpi` : `${rx} × ${ry} dpi`;
}

export function imageProperties(facts: ImageFacts): PreviewProperty[] {
  return new PropertyList()
    .text("title", facts.title)
    .text("author", facts.author)
    .text("camera", facts.camera)
    .date("taken", facts.taken)
    .number("frames", facts.frames)
    .text("colorMode", facts.colorMode)
    .number("bitDepth", facts.bitDepth || undefined)
    .text("resolution", facts.resolution && dpi(facts.resolution))
    .text("application", facts.application)
    .text("comment", facts.comment).items;
}

/** The first bytes of a file by a range request, and its full size. */
export async function fetchHead(
  url: string,
  signal?: AbortSignal,
  length = IMAGE_HEAD_BYTES,
): Promise<{ bytes: Uint8Array; total: number }> {
  const response = await fetch(url, {
    signal,
    headers: { Range: `bytes=0-${length - 1}` },
  });
  if (!response.ok)
    throw new Error(`Failed to read the file (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const total = Number(
    /\/(\d+)$/.exec(response.headers.get("content-range") ?? "")?.[1] ??
      bytes.byteLength,
  );
  return { bytes, total };
}

/**
 * Reads an image's metadata from its URL: the first bytes by a range
 * request, and the whole file only for animations up to a size limit.
 */
export async function fetchImageFacts(
  url: string,
  signal?: AbortSignal,
): Promise<ImageFacts> {
  const head = await fetchHead(url, signal);
  let bytes = head.bytes;
  if (
    head.total > bytes.byteLength &&
    head.total <= IMAGE_FRAME_SCAN_BYTES &&
    needsWholeImage(bytes)
  ) {
    const whole = await fetch(url, { signal });
    if (whole.ok) bytes = new Uint8Array(await whole.arrayBuffer());
  }
  return readImageFacts(bytes);
}
