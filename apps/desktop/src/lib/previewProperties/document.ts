/**
 * Properties of pages, mail, e-books and fixed-layout documents, read from
 * what their renderers already parsed.
 */
import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import type { Ebook } from "@/lib/ebook";
import { formatAddress, type MailAddress, type MailMessage } from "@/lib/email";
import { PropertyList } from "./propertyList";

/** An HTML page's title, language, author and description. */
export function htmlProperties(html: string): PreviewProperty[] {
  // The head is enough, and parsing a huge body only to read it is not.
  const end = html.search(/<body[\s>]/i);
  const head = end > 0 ? html.slice(0, end) : html.slice(0, 200_000);
  const document = new DOMParser().parseFromString(head, "text/html");
  const meta = (name: string) =>
    Array.from(document.querySelectorAll("meta[name]"))
      .find((element) => element.getAttribute("name")?.toLowerCase() === name)
      ?.getAttribute("content");
  const lang = /<html\b[^>]*?\blang\s*=\s*["']?([^"'\s>]+)/i.exec(head)?.[1];
  return new PropertyList()
    .text("title", document.querySelector("title")?.textContent)
    .text("subject", meta("description"))
    .text("author", meta("author"))
    .text("keywords", meta("keywords"))
    .text("language", lang)
    .text("application", meta("generator")).items;
}

const addresses = (list: readonly MailAddress[]) =>
  list.map(formatAddress).filter(Boolean).join(", ");

/** An email's headers as Details shows them. */
export function mailProperties(message: MailMessage): PreviewProperty[] {
  const attachments = message.attachments.filter((item) => !item.inline);
  return new PropertyList()
    .text("subject", message.subject)
    .text("from", message.from ? formatAddress(message.from) : undefined)
    .text("to", addresses(message.to))
    .text("cc", addresses(message.cc))
    .date("sent", message.date)
    .number("attachments", attachments.length || undefined).items;
}

export function ebookProperties(book: Ebook): PreviewProperty[] {
  return new PropertyList()
    .text("title", book.title)
    .text("author", book.author)
    .text("publisher", book.publisher)
    .date("published", book.published)
    .text("language", book.language)
    .text("identifier", book.identifier)
    .number("chapters", book.chapters.length).items;
}

const ofdField = (xml: Document, name: string) =>
  Array.from(xml.getElementsByTagName("*"))
    .find((element) => element.localName === name)
    ?.textContent?.trim() || undefined;

/** OFD's document information, from `OFD.xml` at the package root. */
export function ofdProperties(ofdXml: string): PreviewProperty[] {
  const xml = new DOMParser().parseFromString(ofdXml, "application/xml");
  if (xml.querySelector("parsererror")) return [];
  const root = xml.documentElement;
  const creator = ofdField(xml, "Creator");
  const creatorVersion = ofdField(xml, "CreatorVersion");
  return new PropertyList()
    .text("title", ofdField(xml, "Title"))
    .text("author", ofdField(xml, "Author"))
    .text("subject", ofdField(xml, "Subject"))
    .text("keywords", ofdField(xml, "Keyword"))
    .text(
      "application",
      creator && creatorVersion ? `${creator} ${creatorVersion}` : creator,
    )
    .date("documentCreated", ofdField(xml, "CreationDate"))
    .date("documentModified", ofdField(xml, "ModDate"))
    .text("version", root?.getAttribute("Version")).items;
}

/** Reads `OFD.xml` from an OFD package, or nothing when it has none. */
export async function readOfdProperties(
  bytes: ArrayBuffer,
): Promise<PreviewProperty[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("OFD.xml") ?? zip.file(/^ofd\.xml$/i)[0] ?? undefined;
  return entry ? ofdProperties(await entry.async("string")) : [];
}

/** A Typst string literal's value, with its escapes read. */
function typstString(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, (_, char: string) =>
      char === "n" ? "\n" : char === "t" ? "\t" : char,
    );
}

const STRING = /"(?:[^"\\]|\\.)*"/;

/**
 * The title, author, keywords and date a Typst document sets with
 * `#set document(...)`. Only string literals (and arrays of them) are read;
 * computed values are left out.
 */
export function typstProperties(source: string): PreviewProperty[] {
  const call = /#set\s+document\s*\(/.exec(source);
  if (!call) return [];
  // The argument list, up to its closing parenthesis outside strings.
  let depth = 1;
  let end = call.index + call[0].length;
  for (; end < source.length && depth; end++) {
    const char = source[end];
    if (char === '"') {
      const string = STRING.exec(source.slice(end));
      end += (string?.[0].length ?? 1) - 1;
    } else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
  }
  const args = source.slice(call.index + call[0].length, end - 1);
  const value = (name: string): string | undefined => {
    const field = new RegExp(
      `(?:^|[,(\\s])${name}\\s*:\\s*(${STRING.source}|\\((?:\\s*${STRING.source}\\s*,?)*\\s*\\))`,
    ).exec(args);
    if (!field) return undefined;
    const strings = field[1].match(new RegExp(STRING.source, "g")) ?? [];
    return strings.map(typstString).join(", ") || undefined;
  };
  const date = /(?:^|[,(\s])date\s*:\s*datetime\s*\(([^)]*)\)/.exec(args)?.[1];
  const part = (name: string) =>
    date ? new RegExp(`${name}\\s*:\\s*(\\d+)`).exec(date)?.[1] : undefined;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return new PropertyList()
    .text("title", value("title"))
    .text("author", value("author"))
    .text("subject", value("description"))
    .text("keywords", value("keywords"))
    .text(
      "documentCreated",
      year
        ? [year, month, day]
            .filter(Boolean)
            .map((item, index) => (index ? item!.padStart(2, "0") : item))
            .join("-")
        : undefined,
    ).items;
}

/**
 * A DSC comment value: the first `(text)` when it is given in parentheses
 * (`%%For: (name) (company)`); `(atend)` means it is not in the header.
 */
function dscText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "(atend)") return undefined;
  if (!trimmed.startsWith("(")) return trimmed;
  return /^\(((?:[^()\\]|\\.)*)\)/.exec(trimmed)?.[1].replace(/\\(.)/g, "$1");
}

/**
 * The document structuring comments at the top of a PostScript or EPS
 * file: `%%Title`, `%%Creator`, `%%For`, `%%CreationDate`, the language
 * level (`%%LanguageLevel`) and the EPS version.
 */
export function postScriptProperties(source: string): PreviewProperty[] {
  const header = source.slice(0, 64_000);
  const comment = (name: string) =>
    dscText(new RegExp(`^%%${name}:[ \\t]*(.*?)\\s*$`, "m").exec(header)?.[1]);
  const epsf = /^%!PS-Adobe-\S+\s+EPSF-(\d+(?:\.\d+)?)/.exec(header)?.[1];
  const level = comment("LanguageLevel");
  return new PropertyList()
    .text("title", comment("Title"))
    .text("author", comment("For"))
    .text("application", comment("Creator"))
    .date("documentCreated", comment("CreationDate"))
    .text(
      "version",
      [level && `PostScript Level ${level}`, epsf && `EPSF ${epsf}`]
        .filter(Boolean)
        .join(", "),
    ).items;
}
