import type JSZip from "jszip";
import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";
import { elementsNamed, firstText, parseXml, PropertyList } from "./properties";

async function zipText(zip: JSZip, path: string): Promise<string | undefined> {
  return zip.file(path)?.async("string");
}

async function zipXml(zip: JSZip, path: string): Promise<Document | undefined> {
  const text = await zipText(zip, path);
  return text === undefined ? undefined : parseXml(text);
}

/** "16.0000" → "16.0", the way Office shows its own version. */
function officeVersion(value: string | undefined): string | undefined {
  const match = value?.trim().match(/^(\d+)\.(\d*?)0*$/);
  return match ? `${match[1]}.${match[2] || "0"}` : value?.trim();
}

/**
 * Office Open XML (Word, PowerPoint, Excel): the core properties in
 * `docProps/core.xml` and the application's statistics in `docProps/app.xml`.
 */
export async function readOpenXmlProperties(
  zip: JSZip,
): Promise<PreviewProperty[]> {
  const [core, app] = await Promise.all([
    zipXml(zip, "docProps/core.xml"),
    zipXml(zip, "docProps/app.xml"),
  ]);
  const list = new PropertyList();
  if (core)
    list
      .text("title", firstText(core, "title"))
      .text("subject", firstText(core, "subject"))
      .text("author", firstText(core, "creator"))
      .text("lastModifiedBy", firstText(core, "lastModifiedBy"))
      .text("keywords", firstText(core, "keywords"))
      .text("comment", firstText(core, "description"))
      .text("language", firstText(core, "language"))
      .date("documentCreated", firstText(core, "created"))
      .date("documentModified", firstText(core, "modified"));
  const application = app && firstText(app, "Application")?.trim();
  if (application) {
    const version = officeVersion(firstText(app, "AppVersion"));
    list.text(
      "application",
      version ? `${application} ${version}` : application,
    );
  }
  if (zip.file("word/document.xml") && app)
    list
      .number("words", firstText(app, "Words"))
      .number("characters", firstText(app, "Characters"))
      .number("paragraphs", firstText(app, "Paragraphs"));
  if (zip.file("ppt/presentation.xml")) {
    const slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/).length;
    list.number(
      "slides",
      (app && firstText(app, "Slides")) || slides || undefined,
    );
  }
  const workbook = await zipText(zip, "xl/workbook.xml");
  if (workbook)
    list.number("sheets", workbook.match(/<(?:\w+:)?sheet\b/g)?.length);
  return list.items;
}

/** An attribute by its local name, whatever its prefix. */
function attribute(element: Element, localName: string): string | undefined {
  return [...element.attributes].find(
    (item) => item.name === localName || item.name.endsWith(`:${localName}`),
  )?.value;
}

/** "LibreOffice/7.6.4.1$MacOSX_AARCH64 …" → "LibreOffice 7.6.4.1". */
function odfGenerator(value: string | undefined): string | undefined {
  return value?.split("$")[0]?.replace("/", " ");
}

/**
 * OpenDocument metadata, from `meta.xml` in a package or the `office:meta`
 * of a flat XML document. `mimeType` tells text, spreadsheets and
 * presentations apart.
 */
export function readOpenDocumentMeta(
  document: Document,
  mimeType: string,
): PreviewProperty[] {
  const root = document.documentElement;
  const meta = [...root.children].find((child) => child.localName === "meta");
  if (!meta) return [];
  const list = new PropertyList()
    .text("title", firstText(meta, "title"))
    .text("subject", firstText(meta, "subject"))
    .text(
      "author",
      firstText(meta, "initial-creator") ?? firstText(meta, "creator"),
    )
    .text("lastModifiedBy", firstText(meta, "creator"))
    .text(
      "keywords",
      elementsNamed(meta, "keyword")
        .map((element) => element.textContent?.trim())
        .filter(Boolean)
        .join(", "),
    )
    .text("comment", firstText(meta, "description"))
    .text("language", firstText(meta, "language"))
    .date("documentCreated", firstText(meta, "creation-date"))
    .date("documentModified", firstText(meta, "date"))
    .text("application", odfGenerator(firstText(meta, "generator")));
  const version = attribute(root, "version");
  if (version) list.text("version", `ODF ${version}`);
  const statistic = elementsNamed(meta, "document-statistic")[0];
  const count = (name: string) => statistic && attribute(statistic, name);
  if (mimeType.includes("spreadsheet"))
    list.number("sheets", count("table-count"));
  else if (mimeType.includes("presentation"))
    list.number("slides", count("page-count") || count("object-count"));
  else {
    list
      .number("words", count("word-count"))
      .number("characters", count("character-count"))
      .number("paragraphs", count("paragraph-count"));
    const tables = Number(count("table-count"));
    if (tables > 0) list.number("tables", tables);
  }
  return list.items;
}

export async function readOpenDocumentProperties(
  zip: JSZip,
): Promise<PreviewProperty[]> {
  const [meta, mimeType] = await Promise.all([
    zipXml(zip, "meta.xml"),
    zipText(zip, "mimetype"),
  ]);
  return meta ? readOpenDocumentMeta(meta, mimeType ?? "") : [];
}

const iworkApplications: Record<string, string> = {
  key: "Keynote",
  pages: "Pages",
  numbers: "Numbers",
};

/**
 * Apple iWork: the app version that last saved the document, from its build
 * history ("M6.5.3-2151-2" is Keynote 6.5.3), and a Keynote's slide count.
 */
export async function readIWorkProperties(
  zip: JSZip,
  extension: string,
): Promise<PreviewProperty[]> {
  const list = new PropertyList();
  const history =
    (await zipText(zip, "Metadata/BuildVersionHistory.plist")) ??
    (await zipText(zip, "buildVersionHistory.plist"));
  const builds = [...(history?.matchAll(/<string>M(\d+(?:\.\d+)*)/g) ?? [])];
  const version = builds.at(-1)?.[1];
  const application = iworkApplications[extension];
  if (application && version)
    list.text("application", `${application} ${version}`);
  if (extension === "key") {
    const slides = zip.file(/^Index\/Slide[-\d]*\.iwa$/).length;
    if (slides) list.number("slides", slides);
  }
  return list.items;
}
