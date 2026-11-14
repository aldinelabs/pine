import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { readZipProperties } from "./archive";
import {
  readIWorkProperties,
  readOpenDocumentMeta,
  readOpenDocumentProperties,
  readOpenXmlProperties,
} from "./office";
import { readPdfProperties } from "./pdf";
import { parseXml, PropertyList, sortProperties } from "./properties";
import { readRtfProperties } from "./rtf";

export interface FileViewerPropertiesSource {
  /** `viewer.getRenderer().id`. */
  rendererId: string;
  fileName: string;
  buffer: ArrayBuffer;
  locale: string;
}

/** Flat OpenDocument files are one XML document; larger ones are skipped. */
const FLAT_XML_LIMIT = 32 * 1024 * 1024;
const flatOpenDocument = new Set(["fodt", "fods", "fodp", "fodg"]);
const flatMimeTypes: Record<string, string> = {
  fods: "spreadsheet",
  fodp: "presentation",
};

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, text: string, offset = 0): boolean {
  for (let index = 0; index < text.length; index++)
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  return true;
}

async function readPackage(
  source: FileViewerPropertiesSource,
  extension: string,
): Promise<PreviewProperty[]> {
  if (source.rendererId === "archive")
    return readZipProperties(source.buffer, source.locale);
  // JSZip reads the central directory up front and entries only on demand.
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(source.buffer);
  if (zip.file("docProps/core.xml") || zip.file("docProps/app.xml"))
    return readOpenXmlProperties(zip);
  if (zip.file("meta.xml")) return readOpenDocumentProperties(zip);
  if (extension in { key: 1, pages: 1, numbers: 1 })
    return readIWorkProperties(zip, extension);
  return [];
}

/**
 * What a document handed to file-viewer records about itself: PDF info,
 * Office and OpenDocument properties, RTF info, iWork versions and ZIP
 * archive totals. Formats it does not know, and files it cannot parse,
 * give no properties.
 */
export async function readFileViewerProperties(
  source: FileViewerPropertiesSource,
): Promise<PreviewProperty[]> {
  const bytes = new Uint8Array(
    source.buffer,
    0,
    Math.min(source.buffer.byteLength, 1024),
  );
  const extension = extensionOf(source.fileName);
  try {
    if (
      startsWith(bytes, "%PDF-") ||
      (extension === "pdf" && latin1Includes(bytes, "%PDF-"))
    )
      return sortProperties(await readPdfProperties(source.buffer));
    if (startsWith(bytes, "PK\x03\x04"))
      return sortProperties(await readPackage(source, extension));
    if (startsWith(bytes, "{\\rtf"))
      return sortProperties(readRtfProperties(source.buffer));
    if (
      flatOpenDocument.has(extension) &&
      source.buffer.byteLength <= FLAT_XML_LIMIT
    ) {
      const document = parseXml(new TextDecoder().decode(source.buffer));
      return document
        ? sortProperties(
            readOpenDocumentMeta(document, flatMimeTypes[extension] ?? "text"),
          )
        : [];
    }
  } catch (error) {
    console.debug("Could not read the document's properties.", error);
  }
  return [];
}

/** Some PDFs start with a few bytes of junk before their header. */
function latin1Includes(bytes: Uint8Array, text: string): boolean {
  for (let offset = 1; offset + text.length <= bytes.length; offset++)
    if (startsWith(bytes, text, offset)) return true;
  return false;
}

const slideExtensions = new Set([
  "ppt",
  "pptx",
  "pptm",
  "pps",
  "ppsx",
  "ppsm",
  "pot",
  "potx",
  "potm",
  "key",
  "odp",
  "fodp",
  "dps",
  "dpt",
]);
const sheetExtensions = new Set([
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "xlt",
  "xltx",
  "xltm",
  "ods",
  "fods",
  "numbers",
  "et",
  "ett",
]);

/**
 * Adds counts the viewer itself knows when the file does not record them:
 * a presentation's pages are its slides, a workbook's tabs its sheets.
 */
export function withViewerCounts(
  properties: readonly PreviewProperty[],
  fileName: string,
  counts: { pages?: number; sheets?: number },
): PreviewProperty[] {
  const extension = extensionOf(fileName);
  const list = new PropertyList();
  list.items.push(...properties);
  if (slideExtensions.has(extension) && counts.pages)
    list.number("slides", counts.pages);
  if (sheetExtensions.has(extension) && counts.sheets)
    list.number("sheets", counts.sheets);
  return sortProperties(list.items);
}
