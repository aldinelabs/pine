import { describe, expect, it } from "vitest";
import { hasCjkText, splitTypstPages, typstErrorMessages } from "../typst";

describe("hasCjkText", () => {
  it("finds Chinese, Japanese and Korean text and full-width punctuation", () => {
    expect(hasCjkText("= Typst 预览")).toBe(true);
    expect(hasCjkText("ひらがな")).toBe(true);
    expect(hasCjkText("한국어")).toBe(true);
    expect(hasCjkText("a，b")).toBe(true);
  });

  it("ignores Latin text and math", () => {
    expect(hasCjkText("= Title\n$a^2 + b^2 = c^2$ — café")).toBe(false);
  });
});

describe("splitTypstPages", () => {
  const document = `<svg xmlns="http://www.w3.org/2000/svg" class="typst-doc" width="596" height="1704" data-width="596" data-height="1704">
  <defs><symbol id="g1"><path d="M0 0h1v1z"/></symbol></defs>
  <style>.typst-text { fill: black; }</style>
  <g class="typst-page" transform="translate(0, 0)" data-page-width="596" data-page-height="842"><use href="#g1"/></g>
  <g class="typst-page" transform="translate(0, 862)" data-page-width="420" data-page-height="595"><use href="#g1"/></g>
</svg>`;

  it("makes a standalone SVG for each page with the shared definitions", () => {
    const pages = splitTypstPages(document);
    expect(pages.map(({ width, height }) => [width, height])).toEqual([
      [596, 842],
      [420, 595],
    ]);
    const second = new DOMParser().parseFromString(
      pages[1].svg,
      "image/svg+xml",
    ).documentElement;
    expect(second.getAttribute("viewBox")).toBe("0 0 420 595");
    expect(second.querySelector("symbol#g1")).not.toBeNull();
    expect(second.querySelector("style")?.textContent).toContain("typst-text");
    const page = second.querySelector("g");
    expect(page?.hasAttribute("transform")).toBe(false);
  });

  it("keeps a document without page groups whole", () => {
    const pages = splitTypstPages(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="1" height="1"/></svg>',
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ width: 100, height: 50 });
  });

  it("rejects output that is not SVG", () => {
    expect(() => splitTypstPages("<html></html>")).toThrow();
  });
});

describe("typstErrorMessages", () => {
  it("keeps the message of each compiler diagnostic", () => {
    expect(
      typstErrorMessages(
        '[SourceDiagnostic { severity: Error, span: Span(1), message: "expected expression", trace: [], hints: [] }, SourceDiagnostic { severity: Error, span: Span(2), message: "unknown variable: \\"x\\"", trace: [], hints: [] }]',
      ),
    ).toEqual(["expected expression", 'unknown variable: "x"']);
  });

  it("falls back to the error text", () => {
    expect(typstErrorMessages(new Error(" wasm failed "))).toEqual([
      "wasm failed",
    ]);
  });
});
