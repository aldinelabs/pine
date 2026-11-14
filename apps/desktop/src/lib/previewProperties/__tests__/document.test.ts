import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  ebookProperties,
  htmlProperties,
  mailProperties,
  ofdProperties,
  postScriptProperties,
  readOfdProperties,
  typstProperties,
} from "../document";

describe("document properties", () => {
  it("reads a page's title, language and meta tags", () => {
    expect(
      htmlProperties(
        '<!doctype html><html lang="zh-CN"><head><title> Report </title><meta name="Author" content="Ada"><meta name="description" content="Q3 results"></head><body><title>ignored</title></body></html>',
      ),
    ).toEqual([
      { key: "title", value: "Report" },
      { key: "subject", value: "Q3 results" },
      { key: "author", value: "Ada" },
      { key: "language", value: "zh-CN" },
    ]);
    expect(htmlProperties("<p>bare</p>")).toEqual([]);
  });

  it("lists an email's headers and its attached files", () => {
    expect(
      mailProperties({
        subject: "Plan",
        from: { name: "Ada", address: "ada@example.com" },
        to: [{ address: "lin@example.com" }, { name: "Bo" }],
        cc: [],
        date: new Date("2024-03-01T09:30:00Z"),
        headers: [],
        attachments: [
          { name: "a.pdf", inline: false, data: new Uint8Array() },
          { name: "logo.png", inline: true, data: new Uint8Array() },
        ],
      }),
    ).toEqual([
      { key: "subject", value: "Plan" },
      { key: "from", value: "Ada <ada@example.com>" },
      { key: "to", value: "lin@example.com, Bo" },
      { key: "sent", type: "date", value: "2024-03-01T09:30:00.000Z" },
      { key: "attachments", type: "number", value: 1 },
    ]);
  });

  it("keeps a book's date-only publication date as written", () => {
    expect(
      ebookProperties({
        title: "Book",
        publisher: "Press",
        published: "2010-05-01",
        language: "en",
        identifier: "9780000000000",
        chapters: [{ title: "1", depth: 0, load: () => Promise.resolve("") }],
      }),
    ).toEqual([
      { key: "title", value: "Book" },
      { key: "publisher", value: "Press" },
      { key: "published", value: "2010-05-01" },
      { key: "language", value: "en" },
      { key: "identifier", value: "9780000000000" },
      { key: "chapters", type: "number", value: 1 },
    ]);
  });

  const ofdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016" Version="1.1" DocType="OFD">
  <ofd:DocBody><ofd:DocInfo>
    <ofd:Title>Invoice</ofd:Title><ofd:Author>Tax Bureau</ofd:Author>
    <ofd:CreationDate>2023-06-01</ofd:CreationDate>
    <ofd:Creator>Suwell</ofd:Creator><ofd:CreatorVersion>2.0</ofd:CreatorVersion>
  </ofd:DocInfo></ofd:DocBody>
</ofd:OFD>`;

  it("reads OFD document information", async () => {
    const expected = [
      { key: "title", value: "Invoice" },
      { key: "author", value: "Tax Bureau" },
      { key: "application", value: "Suwell 2.0" },
      { key: "documentCreated", value: "2023-06-01" },
      { key: "version", value: "1.1" },
    ];
    expect(ofdProperties(ofdXml)).toEqual(expected);
    const zip = new JSZip().file("OFD.xml", ofdXml);
    expect(
      await readOfdProperties(await zip.generateAsync({ type: "arraybuffer" })),
    ).toEqual(expected);
    expect(ofdProperties("not xml <")).toEqual([]);
  });

  it("reads string literals in a Typst document call", () => {
    expect(
      typstProperties(
        '#set page(paper: "a4")\n#set document(title: "Thesis (draft)", author: ("Ada", "Lin"), keywords: "a, b", date: datetime(year: 2024, month: 3, day: 9))\n= Hi',
      ),
    ).toEqual([
      { key: "title", value: "Thesis (draft)" },
      { key: "author", value: "Ada, Lin" },
      { key: "keywords", value: "a, b" },
      { key: "documentCreated", value: "2024-03-09" },
    ]);
    expect(typstProperties("#set document(title: [Content])")).toEqual([]);
    expect(typstProperties("= No document call")).toEqual([]);
  });

  it("reads PostScript document structuring comments", () => {
    expect(
      postScriptProperties(
        "%!PS-Adobe-3.0 EPSF-3.0\n%%Title: (chart.eps)\n%%Creator: Illustrator\n%%For: (ada)\n%%CreationDate: (atend)\n%%LanguageLevel: 2\n%%EndComments\n",
      ),
    ).toEqual([
      { key: "title", value: "chart.eps" },
      { key: "author", value: "ada" },
      { key: "application", value: "Illustrator" },
      { key: "version", value: "PostScript Level 2, EPSF 3.0" },
    ]);
    expect(postScriptProperties("%!PS\nshowpage")).toEqual([]);
  });
});
