import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readFileViewerProperties, withViewerCounts } from "..";
import { decodePdfString, pdfDate } from "../pdf";
import { isoDate } from "../properties";

const encoder = new TextEncoder();

function bytes(text: string): ArrayBuffer {
  const data = Uint8Array.from(text, (char) => char.charCodeAt(0));
  return data.buffer;
}

function read(fileName: string, buffer: ArrayBuffer, rendererId = "") {
  return readFileViewerProperties({
    rendererId,
    fileName,
    buffer,
    locale: "en-US",
  });
}

async function zip(
  files: Record<string, string>,
  comment?: string,
): Promise<ArrayBuffer> {
  const archive = new JSZip();
  for (const [path, content] of Object.entries(files))
    archive.file(path, content);
  return archive.generateAsync({ type: "arraybuffer", comment });
}

async function deflate(text: string): Promise<string> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const data = new Uint8Array(await new Response(stream).arrayBuffer());
  return String.fromCharCode(...data);
}

describe("PDF", () => {
  it("reads the Info dictionary named by the last trailer", async () => {
    const pdf = [
      "%PDF-1.7",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "3 0 obj << /Title (Old) >> endobj",
      "4 0 obj",
      "<< /Title (Annual \\(draft\\) report) /Author <FEFF5F204E09>",
      "   /Subject (Line\\012two) /Keywords (a, b) /Creator (Writer)",
      "   /Producer (Typst 0.14.2) /CreationDate (D:20230102030405+08'00')",
      "   /ModDate (D:2024) /Empty () >>",
      "endobj",
      "trailer << /Root 1 0 R /Info 3 0 R >>",
      "trailer << /Root 1 0 R /Info 4 0 R >>",
      "%%EOF",
    ].join("\n");
    expect(await read("a.pdf", bytes(pdf))).toEqual([
      { key: "title", value: "Annual (draft) report" },
      { key: "subject", value: "Line two" },
      { key: "author", value: "张三" },
      { key: "keywords", value: "a, b" },
      {
        key: "documentCreated",
        type: "date",
        value: "2023-01-02T03:04:05+08:00",
      },
      { key: "documentModified", type: "date", value: "2024-01-01T00:00:00" },
      { key: "application", value: "Writer" },
      { key: "producer", value: "Typst 0.14.2" },
      { key: "version", value: "PDF 1.7" },
    ]);
  });

  it("finds Info in a compressed object stream and fills gaps from XMP", async () => {
    const objects = "5 0 << /Title (Packed) >>";
    const packed = await deflate(objects);
    const xmp =
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">' +
      "<dc:title><rdf:Alt><rdf:li>Ignored</rdf:li></rdf:Alt></dc:title>" +
      "<dc:creator><rdf:Seq><rdf:li>Ann</rdf:li><rdf:li>Bo</rdf:li></rdf:Seq></dc:creator>" +
      "<xmp:CreateDate>2020-05-06T07:08:09Z</xmp:CreateDate>" +
      "</rdf:Description></rdf:RDF></x:xmpmeta>";
    const pdf = [
      "%PDF-1.5",
      `6 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${packed.length} >>`,
      `stream\n${packed}\nendstream endobj`,
      "1 0 obj << /Type /Catalog /Metadata 7 0 R >> endobj",
      `7 0 obj << /Type /Metadata /Subtype /XML /Length ${xmp.length} >>`,
      `stream\n${xmp}\nendstream endobj`,
      "8 0 obj << /Type /XRef /Root 1 0 R /Info 5 0 R >> endobj",
    ].join("\n");
    expect(await read("a.pdf", bytes(pdf))).toEqual([
      { key: "title", value: "Packed" },
      { key: "author", value: "Ann, Bo" },
      {
        key: "documentCreated",
        type: "date",
        value: "2020-05-06T07:08:09Z",
      },
      { key: "version", value: "PDF 1.5" },
    ]);
  });

  it("reports only the version of an encrypted file", async () => {
    const pdf =
      "%PDF-1.4\n4 0 obj << /Title <8a9f> >> endobj\n" +
      "trailer << /Info 4 0 R /Encrypt 9 0 R >>";
    expect(await read("a.pdf", bytes(pdf))).toEqual([
      { key: "version", value: "PDF 1.4" },
      { key: "encrypted", type: "boolean", value: true },
    ]);
  });

  it("decodes strings and dates", () => {
    expect(decodePdfString([0x93, 0x41])).toBe("ﬁA");
    expect(pdfDate("D:199812231952-08'00")).toBe("1998-12-23T19:52:00-08:00");
    expect(pdfDate("D:20010203Z")).toBe("2001-02-03T00:00:00Z");
    expect(pdfDate("garbage")).toBeUndefined();
  });

  it("gives nothing for a damaged file", async () => {
    expect(await read("a.pdf", bytes("%PDF-"))).toEqual([]);
  });
});

const core =
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">' +
  "<dc:title>Plan</dc:title><dc:subject></dc:subject><dc:creator>Ann</dc:creator>" +
  "<cp:lastModifiedBy>Bo</cp:lastModifiedBy><cp:keywords>q1, budget</cp:keywords>" +
  "<dcterms:created>2023-05-22T14:51:00Z</dcterms:created>" +
  "<dcterms:modified>1601-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>";

describe("Office Open XML", () => {
  it("reads a Word document's core properties and statistics", async () => {
    const file = await zip({
      "[Content_Types].xml": "<Types/>",
      "docProps/core.xml": core,
      "docProps/app.xml":
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
        "<Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion>" +
        "<Words>7422</Words><Characters>42306</Characters><Paragraphs>99</Paragraphs></Properties>",
      "word/document.xml": "<w:document/>",
    });
    expect(await read("a.docx", file)).toEqual([
      { key: "title", value: "Plan" },
      { key: "author", value: "Ann" },
      { key: "lastModifiedBy", value: "Bo" },
      { key: "keywords", value: "q1, budget" },
      {
        key: "documentCreated",
        type: "date",
        value: "2023-05-22T14:51:00Z",
      },
      { key: "application", value: "Microsoft Office Word 16.0" },
      { key: "words", type: "number", value: 7422 },
      { key: "characters", type: "number", value: 42306 },
      { key: "paragraphs", type: "number", value: 99 },
    ]);
  });

  it("counts slides and sheets", async () => {
    const presentation = await zip({
      "docProps/core.xml": core,
      "ppt/presentation.xml": "<p/>",
      "ppt/slides/slide1.xml": "<p/>",
      "ppt/slides/slide2.xml": "<p/>",
    });
    expect(await read("a.pptx", presentation)).toContainEqual({
      key: "slides",
      type: "number",
      value: 2,
    });
    const workbook = await zip({
      "docProps/app.xml":
        "<Properties><Application>Excel</Application></Properties>",
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="A"/><sheet name="B"/></sheets></workbook>',
    });
    expect(await read("a.xlsx", workbook)).toEqual([
      { key: "application", value: "Excel" },
      { key: "sheets", type: "number", value: 2 },
    ]);
  });
});

const odfMeta = (statistic: string) =>
  '<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3">' +
  "<office:meta><meta:initial-creator>Ann</meta:initial-creator><dc:creator>Bo</dc:creator>" +
  "<dc:title>Book</dc:title><meta:keyword>a</meta:keyword><meta:keyword>b</meta:keyword>" +
  "<meta:creation-date>2014-12-03T22:47:12.762739590</meta:creation-date>" +
  "<meta:generator>LibreOffice/7.6.4.1$MacOSX_AARCH64 LibreOffice_project/abc</meta:generator>" +
  `<meta:document-statistic ${statistic}/></office:meta></office:document-meta>`;

describe("OpenDocument", () => {
  it("reads meta.xml with text statistics", async () => {
    const file = await zip({
      mimetype: "application/vnd.oasis.opendocument.text",
      "meta.xml": odfMeta(
        'meta:word-count="894" meta:character-count="6032" meta:paragraph-count="36" meta:table-count="2"',
      ),
    });
    expect(await read("a.odt", file)).toEqual([
      { key: "title", value: "Book" },
      { key: "author", value: "Ann" },
      { key: "lastModifiedBy", value: "Bo" },
      { key: "keywords", value: "a, b" },
      {
        key: "documentCreated",
        type: "date",
        value: "2014-12-03T22:47:12.762",
      },
      { key: "application", value: "LibreOffice 7.6.4.1" },
      { key: "version", value: "ODF 1.3" },
      { key: "words", type: "number", value: 894 },
      { key: "characters", type: "number", value: 6032 },
      { key: "paragraphs", type: "number", value: 36 },
      { key: "tables", type: "number", value: 2 },
    ]);
  });

  it("counts a spreadsheet's tables as sheets", async () => {
    const file = await zip({
      mimetype: "application/vnd.oasis.opendocument.spreadsheet",
      "meta.xml": odfMeta('meta:table-count="3"'),
    });
    expect(await read("a.ods", file)).toContainEqual({
      key: "sheets",
      type: "number",
      value: 3,
    });
  });

  it("reads a flat document's office:meta", async () => {
    const flat = odfMeta("")
      .replace("office:document-meta", "office:document")
      .replace("</office:document-meta>", "</office:document>");
    const properties = await read("a.fodt", encoder.encode(flat).buffer);
    expect(properties).toContainEqual({ key: "title", value: "Book" });
  });
});

describe("iWork", () => {
  it("names the app version that last saved and counts Keynote slides", async () => {
    const file = await zip({
      "Index/Document.iwa": "",
      "Index/Slide1.iwa": "",
      "Index/Slide-2.iwa": "",
      "Metadata/BuildVersionHistory.plist":
        "<plist><array><string>Template: White</string><string>M6.5.3-2151-2</string></array></plist>",
    });
    expect(await read("a.key", file)).toEqual([
      { key: "application", value: "Keynote 6.5.3" },
      { key: "slides", type: "number", value: 2 },
    ]);
  });
});

describe("RTF", () => {
  it("reads the info group", async () => {
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252{\\*\\generator Riched20 10.0;}" +
      "{\\info{\\title Caf\\'e9 \\{menu\\}}{\\author \\u24352?\\u19977?}{\\operator Bo}" +
      "{\\creatim\\yr2023\\mo1\\dy2\\hr3\\min4}{\\keywords }\\nofwords12\\nofchars80}" +
      "Hello}";
    expect(await read("a.rtf", bytes(rtf))).toEqual([
      { key: "title", value: "Café {menu}" },
      { key: "author", value: "张三" },
      { key: "lastModifiedBy", value: "Bo" },
      {
        key: "documentCreated",
        type: "date",
        value: "2023-01-02T03:04:00",
      },
      { key: "application", value: "Riched20 10.0" },
      { key: "words", type: "number", value: 12 },
      { key: "characters", type: "number", value: 80 },
    ]);
  });
});

describe("ZIP archives", () => {
  it("totals entries from the central directory", async () => {
    const archive = new JSZip();
    archive.folder("docs");
    archive.file("docs/a.txt", "x".repeat(2048));
    archive.file("b.txt", "hi");
    const buffer = await archive.generateAsync({
      type: "arraybuffer",
      compression: "DEFLATE",
      comment: "Release build",
    });
    expect(await read("a.zip", buffer, "archive")).toEqual([
      { key: "comment", value: "Release build" },
      { key: "entries", type: "number", value: 2 },
      { key: "uncompressedSize", value: "2 KB" },
    ]);
  });
});

describe("viewer counts", () => {
  it("adds slides and sheets the file does not record", () => {
    expect(withViewerCounts([], "a.ppt", { pages: 4, sheets: 0 })).toEqual([
      { key: "slides", type: "number", value: 4 },
    ]);
    expect(
      withViewerCounts([{ key: "sheets", type: "number", value: 2 }], "a.xls", {
        sheets: 5,
      }),
    ).toEqual([{ key: "sheets", type: "number", value: 2 }]);
    expect(withViewerCounts([], "a.docx", { pages: 4 })).toEqual([]);
  });
});

describe("isoDate", () => {
  it("normalizes and rejects placeholder dates", () => {
    expect(isoDate("2023-01-02T03:04:05.123456Z")).toBe(
      "2023-01-02T03:04:05.123Z",
    );
    expect(isoDate("1899-12-30T00:00:00")).toBeUndefined();
    expect(isoDate("soon")).toBeUndefined();
  });

  it("gives nothing for unknown formats", async () => {
    expect(await read("a.bin", bytes("\0\0\0"))).toEqual([]);
  });
});
