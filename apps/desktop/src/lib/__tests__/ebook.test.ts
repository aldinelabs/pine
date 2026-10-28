import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readEpub, readFb2 } from "../ebook";

async function epub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/book.opf",
    `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Pine Book</dc:title><dc:creator>Ada</dc:creator></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="img" href="img/dot.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="text/one.xhtml#top">Opening</a></li></ol></nav></body></html>`,
  );
  zip.file(
    "OEBPS/text/one.xhtml",
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../style.css"/><script>alert(1)</script></head><body><p>Hello</p><img src="../img/dot.png"/></body></html>`,
  );
  zip.file("OEBPS/style.css", "body{background:url(img/dot.png)}");
  zip.file("OEBPS/img/dot.png", new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("readEpub", () => {
  it("reads metadata, titles from the navigation and inlined chapters", async () => {
    const book = await readEpub(await epub());
    expect(book.title).toBe("Pine Book");
    expect(book.author).toBe("Ada");
    expect(book.chapters.map((chapter) => chapter.title)).toEqual(["Opening"]);
    const html = await book.chapters[0].load();
    expect(html).toContain("Hello");
    expect(html).toContain('src="data:image/png;base64,AQID"');
    expect(html).toContain("url(data:image/png;base64,AQID)");
    expect(html).not.toContain("<script");
  });
});

describe("readFb2", () => {
  it("turns sections into escaped chapters", async () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Tale</book-title><author><first-name>A</first-name><last-name>B</last-name></author></title-info></description><body><section><title><p>One</p></title><p>x &lt; y</p><section><title><p>Inner</p></title><p>deep</p></section></section></body></FictionBook>`;
    const book = await readFb2(new TextEncoder().encode(fb2).buffer);
    expect(book.title).toBe("Tale");
    expect(
      book.chapters.map((chapter) => [chapter.title, chapter.depth]),
    ).toEqual([
      ["One", 0],
      ["Inner", 1],
    ]);
    expect(await book.chapters[0].load()).toContain("<p>x &lt; y</p>");
  });
});
