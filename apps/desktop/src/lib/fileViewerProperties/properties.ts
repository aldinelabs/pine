import type {
  PreviewProperty,
  PreviewPropertyKey,
} from "@/components/project/file-preview/previewRenderer";

/** Longer values, such as a licence pasted into a description, are cut. */
const MAX_TEXT = 300;

/**
 * Collects properties, leaving out values that are missing, blank, not a
 * finite number or not a date.
 */
export class PropertyList {
  readonly items: PreviewProperty[] = [];

  has(key: PreviewPropertyKey): boolean {
    return this.items.some((item) => item.key === key);
  }

  text(key: PreviewPropertyKey, value: string | undefined | null): this {
    let text = value?.replace(/\s+/g, " ").trim();
    if (text && text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}…`;
    if (text && !this.has(key)) this.items.push({ key, value: text });
    return this;
  }

  number(key: PreviewPropertyKey, value: number | string | undefined): this {
    const number = typeof value === "string" ? Number(value.trim()) : value;
    if (
      number !== undefined &&
      (typeof value !== "string" || value.trim()) &&
      Number.isFinite(number) &&
      number >= 0 &&
      !this.has(key)
    )
      this.items.push({ key, type: "number", value: number });
    return this;
  }

  date(key: PreviewPropertyKey, value: string | undefined | null): this {
    const date = isoDate(value);
    if (date && !this.has(key))
      this.items.push({ key, type: "date", value: date });
    return this;
  }

  boolean(key: PreviewPropertyKey, value: boolean | undefined): this {
    if (value !== undefined && !this.has(key))
      this.items.push({ key, type: "boolean", value });
    return this;
  }
}

/**
 * An ISO 8601 date and time as JavaScript reads it: fractions of a second
 * cut to milliseconds (OpenDocument writes nanoseconds), or undefined when it
 * is not a real date. Office writes 1601 or 1899 for "never set".
 */
export function isoDate(value: string | undefined | null): string | undefined {
  const text = value
    ?.trim()
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(
      /(T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?) ?([+-]\d{2})(\d{2})$/,
      "$1$2:$3",
    );
  if (!text || !/^\d{4}-\d{2}(-\d{2})?/.test(text)) return undefined;
  const time = Date.parse(text);
  if (!Number.isFinite(time) || new Date(time).getUTCFullYear() < 1902)
    return undefined;
  return text;
}

/** The order Details lists properties in, most useful first. */
const order: readonly PreviewPropertyKey[] = [
  "title",
  "subject",
  "author",
  "lastModifiedBy",
  "keywords",
  "comment",
  "language",
  "documentCreated",
  "documentModified",
  "application",
  "producer",
  "version",
  "words",
  "characters",
  "paragraphs",
  "tables",
  "slides",
  "sheets",
  "entries",
  "uncompressedSize",
  "encrypted",
];

export function sortProperties(
  properties: readonly PreviewProperty[],
): PreviewProperty[] {
  const rank = (key: PreviewPropertyKey) => {
    const index = order.indexOf(key);
    return index < 0 ? order.length : index;
  };
  return [...properties].sort((a, b) => rank(a.key) - rank(b.key));
}

/** First elements named `localName` in any namespace, in document order. */
export function elementsNamed(root: Document | Element, localName: string) {
  return [...root.getElementsByTagName("*")].filter(
    (element) => element.localName === localName,
  );
}

export function firstText(
  root: Document | Element,
  localName: string,
): string | undefined {
  return elementsNamed(root, localName)[0]?.textContent ?? undefined;
}

export function parseXml(text: string): Document | undefined {
  const document = new DOMParser().parseFromString(text, "application/xml");
  return document.getElementsByTagName("parsererror").length
    ? undefined
    : document;
}
