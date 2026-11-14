import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { elementsNamed, firstText, parseXml, PropertyList } from "./properties";

/**
 * PDF document properties: the trailer's Info dictionary, then the
 * catalog's XMP metadata for whatever Info leaves out. Reads the raw bytes
 * without pdf.js; objects inside compressed object streams are found too.
 */

type PdfValue =
  | { type: "string"; bytes: number[] }
  | { type: "ref"; id: number; generation: number }
  | { type: "name"; name: string }
  | { type: "number"; value: number }
  | { type: "dict"; entries: Map<string, PdfValue>; end: number }
  | { type: "other" };

const WHITESPACE = /[\0\t\n\f\r ]/;
const DELIMITER = /[\0\t\n\f\r ()<>[\]{}/%]/;

/** Bytes as one character each, so string offsets are byte offsets. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return text;
}

class PdfParser {
  constructor(private readonly source: string) {}
  position = 0;

  private skipSpace(): void {
    const source = this.source;
    while (this.position < source.length) {
      const char = source[this.position];
      if (WHITESPACE.test(char)) this.position++;
      else if (char === "%")
        while (
          this.position < source.length &&
          !/[\r\n]/.test(source[this.position])
        )
          this.position++;
      else break;
    }
  }

  private token(): string {
    const start = this.position;
    while (
      this.position < this.source.length &&
      !DELIMITER.test(this.source[this.position])
    )
      this.position++;
    return this.source.slice(start, this.position);
  }

  value(depth = 0): PdfValue {
    this.skipSpace();
    const source = this.source;
    const char = source[this.position];
    if (char === undefined || depth > 32) return { type: "other" };
    if (source.startsWith("<<", this.position)) return this.dictionary(depth);
    if (char === "<") return this.hexString();
    if (char === "(") return this.literalString();
    if (char === "/") {
      this.position++;
      return { type: "name", name: this.token() };
    }
    if (char === "[") {
      this.position++;
      for (;;) {
        this.skipSpace();
        if (this.position >= source.length) break;
        if (source[this.position] === "]") {
          this.position++;
          break;
        }
        const before = this.position;
        this.value(depth + 1);
        if (this.position === before) this.position++;
      }
      return { type: "other" };
    }
    const word = this.token();
    if (!word) {
      this.position++;
      return { type: "other" };
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const after = this.position;
      const reference = /^\s+(\d+)\s+R(?=[\0\t\n\f\r ()<>[\]{}/%]|$)/.exec(
        source.slice(after, after + 24),
      );
      if (/^\d+$/.test(word) && reference) {
        this.position = after + reference[0].length;
        return {
          type: "ref",
          id: Number(word),
          generation: Number(reference[1]),
        };
      }
      return { type: "number", value: Number(word) };
    }
    return { type: "other" };
  }

  private dictionary(depth: number): PdfValue {
    const entries = new Map<string, PdfValue>();
    this.position += 2;
    for (;;) {
      this.skipSpace();
      if (this.position >= this.source.length) break;
      if (this.source.startsWith(">>", this.position)) {
        this.position += 2;
        break;
      }
      if (this.source[this.position] !== "/") {
        const before = this.position;
        this.value(depth + 1);
        if (this.position === before) this.position++;
        continue;
      }
      this.position++;
      const key = this.token();
      entries.set(key, this.value(depth + 1));
    }
    return { type: "dict", entries, end: this.position };
  }

  private hexString(): PdfValue {
    const end = this.source.indexOf(">", this.position);
    const hex = this.source
      .slice(this.position + 1, end < 0 ? undefined : end)
      .replace(/[^0-9a-fA-F]/g, "");
    this.position = end < 0 ? this.source.length : end + 1;
    const bytes: number[] = [];
    for (let index = 0; index < hex.length; index += 2)
      bytes.push(parseInt(hex.slice(index, index + 2).padEnd(2, "0"), 16));
    return { type: "string", bytes };
  }

  private literalString(): PdfValue {
    const source = this.source;
    const bytes: number[] = [];
    let depth = 0;
    this.position++;
    while (this.position < source.length) {
      const char = source[this.position++];
      if (char === "(") depth++;
      else if (char === ")") {
        if (depth-- === 0) break;
      } else if (char === "\\") {
        const next = source[this.position++] ?? "";
        const escaped: Record<string, number> = {
          n: 10,
          r: 13,
          t: 9,
          b: 8,
          f: 12,
        };
        if (next in escaped) bytes.push(escaped[next]);
        else if (/[0-7]/.test(next)) {
          let octal = next;
          while (octal.length < 3 && /[0-7]/.test(source[this.position] ?? ""))
            octal += source[this.position++];
          bytes.push(parseInt(octal, 8) & 0xff);
        } else if (next === "\r") {
          if (source[this.position] === "\n") this.position++;
        } else if (next !== "\n") bytes.push(next.charCodeAt(0));
        continue;
      }
      bytes.push(char.charCodeAt(0));
    }
    return { type: "string", bytes };
  }
}

/** PDFDocEncoding differs from Latin-1 in 0x80–0x9F, rarely used in metadata. */
const pdfDocEncoding: Record<number, string> = {
  0x80: "•",
  0x81: "†",
  0x82: "‡",
  0x83: "…",
  0x84: "—",
  0x85: "–",
  0x86: "ƒ",
  0x87: "⁄",
  0x88: "‹",
  0x89: "›",
  0x8a: "−",
  0x8b: "‰",
  0x8c: "„",
  0x8d: "“",
  0x8e: "”",
  0x8f: "‘",
  0x90: "’",
  0x91: "‚",
  0x92: "™",
  0x93: "ﬁ",
  0x94: "ﬂ",
  0x95: "Ł",
  0x96: "Œ",
  0x97: "Š",
  0x98: "Ÿ",
  0x99: "Ž",
  0x9a: "ı",
  0x9b: "ł",
  0x9c: "œ",
  0x9d: "š",
  0x9e: "ž",
  0xa0: "€",
};

export function decodePdfString(bytes: readonly number[]): string {
  const data = Uint8Array.from(bytes);
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder("utf-16be").decode(data.subarray(2));
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf)
    return new TextDecoder().decode(data.subarray(3));
  return bytes
    .map((byte) => pdfDocEncoding[byte] ?? String.fromCharCode(byte))
    .join("");
}

/** "D:20230102030405+08'00'" → "2023-01-02T03:04:05+08:00". */
export function pdfDate(value: string): string | undefined {
  const match =
    /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:(Z)|([+-])(\d{2})'?(\d{2})?'?)?/.exec(
      value.trim(),
    );
  if (!match) return undefined;
  const [
    ,
    year,
    month = "01",
    day = "01",
    hour = "00",
    minute = "00",
    second = "00",
  ] = match;
  const zone = match[7]
    ? "Z"
    : match[8]
      ? `${match[8]}${match[9]}:${match[10] ?? "00"}`
      : "";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  try {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
}

const MAX_OBJECT_STREAMS = 256;

class PdfFile {
  readonly text: string;
  private objectStreams?: Promise<Map<number, string>>;

  constructor(private readonly bytes: Uint8Array) {
    this.text = latin1(bytes);
  }

  /** Where object `id` starts, the last definition winning. */
  private objectStart(id: number): number | undefined {
    const plain = `${id} 0 obj`;
    const index = this.text.lastIndexOf(plain);
    if (index >= 0 && !/\d/.test(this.text[index - 1] ?? ""))
      return index + plain.length;
    const pattern = new RegExp(`(?:^|[^0-9])${id}\\s+\\d+\\s+obj\\b`, "g");
    let start: number | undefined;
    for (const match of this.text.matchAll(pattern))
      start = match.index + match[0].length;
    return start;
  }

  async object(id: number): Promise<PdfValue | undefined> {
    const start = this.objectStart(id);
    if (start !== undefined) {
      const parser = new PdfParser(this.text);
      parser.position = start;
      return parser.value();
    }
    const source = (await this.compressedObjects()).get(id);
    return source === undefined ? undefined : new PdfParser(source).value();
  }

  async resolve(value: PdfValue | undefined): Promise<PdfValue | undefined> {
    return value?.type === "ref" ? this.object(value.id) : value;
  }

  /** Bytes of the stream that follows the dictionary of an object. */
  async stream(
    dictionary: PdfValue & { type: "dict" },
  ): Promise<Uint8Array | undefined> {
    const keyword = /^\s*stream\r?\n/.exec(
      this.text.slice(dictionary.end, dictionary.end + 32),
    );
    if (!keyword) return undefined;
    const start = dictionary.end + keyword[0].length;
    const length = await this.resolve(dictionary.entries.get("Length"));
    let end =
      length?.type === "number"
        ? start + length.value
        : this.text.indexOf("endstream", start);
    if (end < start || end > this.bytes.length)
      end = this.text.indexOf("endstream", start);
    if (end < start) return undefined;
    const data = this.bytes.subarray(start, end);
    const filter = dictionary.entries.get("Filter");
    if (!filter) return data;
    return filter.type === "name" && filter.name === "FlateDecode"
      ? inflate(data)
      : undefined;
  }

  /** Objects kept in compressed object streams (PDF 1.5), by number. */
  private compressedObjects(): Promise<Map<number, string>> {
    this.objectStreams ??= (async () => {
      const objects = new Map<number, string>();
      const starts = [...this.text.matchAll(/\d+\s+\d+\s+obj\s*<</g)]
        .map((match) => match.index + match[0].length - 2)
        .filter((index) =>
          /\/Type\s*\/ObjStm/.test(this.text.slice(index, index + 400)),
        )
        .slice(-MAX_OBJECT_STREAMS);
      for (const start of starts) {
        const parser = new PdfParser(this.text);
        parser.position = start;
        const dictionary = parser.value();
        if (dictionary.type !== "dict") continue;
        const count = dictionary.entries.get("N");
        const first = dictionary.entries.get("First");
        const data = await this.stream(dictionary);
        if (!data || count?.type !== "number" || first?.type !== "number")
          continue;
        const source = latin1(data);
        const header = source
          .slice(0, first.value)
          .trim()
          .split(/\s+/)
          .map(Number);
        for (
          let index = 0;
          index + 1 < header.length && index / 2 < count.value;
          index += 2
        )
          objects.set(
            header[index],
            source.slice(first.value + header[index + 1]),
          );
      }
      return objects;
    })();
    return this.objectStreams;
  }

  /** The trailer entry `key`, the last trailer or cross-reference stream winning. */
  trailerReference(key: string): number | undefined {
    const pattern = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`, "g");
    let id: number | undefined;
    for (const match of this.text.matchAll(pattern)) id = Number(match[1]);
    return id;
  }
}

async function dictionaryText(
  file: PdfFile,
  dictionary: PdfValue | undefined,
  key: string,
): Promise<string | undefined> {
  if (dictionary?.type !== "dict") return undefined;
  const value = await file.resolve(dictionary.entries.get(key));
  return value?.type === "string" ? decodePdfString(value.bytes) : undefined;
}

function readXmp(list: PropertyList, xml: string): void {
  const document = parseXml(xml);
  if (!document) return;
  const items = (name: string) => {
    const element = elementsNamed(document, name)[0];
    if (!element) return undefined;
    const values = elementsNamed(element, "li").map((li) =>
      li.textContent?.trim(),
    );
    return (
      (values.length
        ? values.filter(Boolean).join(", ")
        : element.textContent) ?? undefined
    );
  };
  list
    .text("title", items("title"))
    .text("author", items("creator"))
    .text("subject", items("description"))
    .text("keywords", firstText(document, "Keywords"))
    .text("application", firstText(document, "CreatorTool"))
    .text("producer", firstText(document, "Producer"))
    .date("documentCreated", firstText(document, "CreateDate"))
    .date("documentModified", firstText(document, "ModifyDate"));
}

/** Larger files are read from their first and last bytes only. */
const WHOLE_FILE_LIMIT = 16 * 1024 * 1024;
const PART_SIZE = 4 * 1024 * 1024;

export async function readPdfProperties(
  buffer: ArrayBuffer,
): Promise<PreviewProperty[]> {
  const all = new Uint8Array(buffer);
  const list = new PropertyList();
  const header = latin1(all.subarray(0, 1024)).match(/%PDF-(\d\.\d)/);
  if (header) list.text("version", `PDF ${header[1]}`);
  const parts =
    all.length <= WHOLE_FILE_LIMIT
      ? [all]
      : [all.subarray(all.length - PART_SIZE), all.subarray(0, PART_SIZE)];
  for (const part of parts) {
    const file = new PdfFile(part);
    const encrypted = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(file.text);
    if (encrypted) {
      // Strings are encrypted too; only the format facts are readable.
      list.boolean("encrypted", true);
      break;
    }
    const infoId = file.trailerReference("Info");
    const info = infoId === undefined ? undefined : await file.object(infoId);
    const rootId = file.trailerReference("Root");
    if (info === undefined && rootId === undefined) continue;
    list
      .text("title", await dictionaryText(file, info, "Title"))
      .text("author", await dictionaryText(file, info, "Author"))
      .text("subject", await dictionaryText(file, info, "Subject"))
      .text("keywords", await dictionaryText(file, info, "Keywords"))
      .text("application", await dictionaryText(file, info, "Creator"))
      .text("producer", await dictionaryText(file, info, "Producer"));
    const created = await dictionaryText(file, info, "CreationDate");
    const modified = await dictionaryText(file, info, "ModDate");
    list
      .date("documentCreated", created && pdfDate(created))
      .date("documentModified", modified && pdfDate(modified));
    const catalog =
      rootId === undefined ? undefined : await file.object(rootId);
    const metadata =
      catalog?.type === "dict"
        ? await file.resolve(catalog.entries.get("Metadata"))
        : undefined;
    if (metadata?.type === "dict") {
      const xmp = await file.stream(metadata);
      if (xmp) readXmp(list, new TextDecoder().decode(xmp));
    }
    break;
  }
  return list.items;
}
