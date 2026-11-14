import { afterEach, describe, expect, it } from "vitest";
import { annotationText } from "@/lib/annotationAnchors";
import { fileViewerAnnotationAdapter } from "..";
import { wordAnnotations } from "../word";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function surfaces(root: HTMLElement) {
  return wordAnnotations.surfaces?.(root) ?? [];
}

function texts(root: HTMLElement): string[] {
  return surfaces(root).map((surface) =>
    annotationText(surface.root, surface.excluded).replace(/\s+/g, " ").trim(),
  );
}

const DOCX = `
  <div class="file-render docx-fit-viewer">
    <style>.docx-fit-viewer { box-sizing: border-box; }</style>
    <style>.docx span { color: red; }</style>
    <div class="docx-wrapper">
      <div class="docx-flow-frame">
        <section class="docx">
          <div class="docx-page-background" aria-hidden="true"></div>
          <header><p>Header</p></header>
          <article><style>.inline { color: blue; }</style><p>First page</p></article>
        </section>
      </div>
      <div class="docx-flow-frame">
        <section class="docx"><article><p>Second page</p></article></section>
      </div>
    </div>
  </div>`;

afterEach(() => {
  document.body.replaceChildren();
});

describe("wordAnnotations", () => {
  it("serves the word processor renderers with text comments", () => {
    for (const id of [
      "office-word-openxml",
      "office-word-binary",
      "office-wordperfect",
      "office-hangul",
      "open-document",
      "apple-pages",
    ])
      expect(fileViewerAnnotationAdapter(id)).toBe(wordAnnotations);
    expect(wordAnnotations.capabilities).toEqual({ annotate: true });
  });

  it("gives each Word page its own surface without the injected styles", () => {
    const root = mount(DOCX);
    const found = surfaces(root);

    expect(found.map((surface) => surface.segment)).toEqual([
      "page:1",
      "page:2",
    ]);
    expect(found.map((surface) => surface.place)).toEqual([
      { kind: "page", number: 1 },
      { kind: "page", number: 2 },
    ]);
    expect(found[0]?.root.matches("section.docx")).toBe(true);
    expect(texts(root)).toEqual(["Header First page", "Second page"]);
  });

  it("finds binary Word, Hangul and Pages pages", () => {
    const doc = mount(`
      <style data-msdoc>.msdoc-root { margin: 0; }</style>
      <div class="msdoc-stage">
        <section class="msdoc-page"><div class="msdoc-root"><p>One</p></div></section>
        <section class="msdoc-page"><div class="msdoc-root"><p>Two</p></div></section>
      </div>`);
    expect(texts(doc)).toEqual(["One", "Two"]);

    const hangul = mount(`
      <style>.hangul-viewer { height: 100%; }</style>
      <div class="hangul-viewer"><div class="hangul-shell">
        <article class="hangul-page"><header class="hangul-header">머리말</header><p>본문</p></article>
      </div></div>`);
    expect(surfaces(hangul).map((surface) => surface.segment)).toEqual([
      "page:1",
    ]);
    expect(texts(hangul)).toEqual(["머리말본문"]);

    const pages = mount(`
      <style>.iwork-viewer { display: grid; }</style>
      <div class="iwork-viewer">
        <nav class="iwork-nav"><button>Page 1</button><button>Page 2</button></nav>
        <main class="iwork-stage">
          <section class="iwork-scene-wrap"><article class="iwork-scene">
            <div class="iwork-text-layer"><div class="iwork-text">Pages one</div></div>
          </article></section>
          <section class="iwork-scene-wrap"><article class="iwork-scene">
            <div class="iwork-text-layer"><div class="iwork-text">Pages two</div></div>
          </article></section>
        </main>
      </div>`);
    expect(surfaces(pages).map((surface) => surface.segment)).toEqual([
      "page:1",
      "page:2",
    ]);
    expect(texts(pages)).toEqual(["Pages one", "Pages two"]);
  });

  it("uses one unsegmented surface for OpenDocument text, RTF and WordPerfect", () => {
    for (const [html, body] of [
      [
        `<article class="odf-page"><p>Lorem</p><p>Ipsum</p></article>`,
        "odf-page",
      ],
      [
        `<div class="flyfish-rtf-viewer"><article class="flyfish-rtf-paper"><span>Rich</span></article></div>`,
        "flyfish-rtf-paper",
      ],
      [
        `<div class="wpd-viewer"><article class="wpd-page"><p>Perfect</p></article></div>`,
        "wpd-page",
      ],
    ] as const) {
      const root = mount(`<style>.x { color: red; }</style>${html}`);
      const [surface, ...rest] = surfaces(root);
      expect(rest).toEqual([]);
      expect(surface?.root.classList.contains(body)).toBe(true);
      expect(surface?.segment).toBeUndefined();
      expect(surface?.place).toBeUndefined();
    }
  });

  it("numbers OpenDocument presentation slides", () => {
    const root = mount(`
      <style>.odf-viewer { padding: 0; }</style>
      <div class="odf-viewer"><section class="odf-shell">
        <article class="odf-page"><p>Slide one</p></article>
        <article class="odf-page"><p>Slide two</p></article>
      </section></div>`);

    expect(surfaces(root).map((surface) => surface.place)).toEqual([
      { kind: "slide", number: 1 },
      { kind: "slide", number: 2 },
    ]);
    expect(surfaces(root).map((surface) => surface.segment)).toEqual([
      "slide:1",
      "slide:2",
    ]);
  });

  it("falls back to the whole render without its styles", () => {
    const root = mount(
      `<style>.unknown { color: red; }</style><div class="unknown"><p>Body</p></div>`,
    );

    expect(surfaces(root).map((surface) => surface.root)).toEqual([root]);
    expect(texts(root)).toEqual(["Body"]);
  });

  it("keeps segments when the document renders again", () => {
    const root = mount(DOCX);
    const before = surfaces(root).map((surface) => surface.segment);
    const firstPage = surfaces(root)[0]?.root;

    root.innerHTML = DOCX;
    const after = surfaces(root);

    expect(after.map((surface) => surface.segment)).toEqual(before);
    expect(after[0]?.root).not.toBe(firstPage);
    expect(texts(root)).toEqual(["Header First page", "Second page"]);
  });

  it("puts a selection inside a page in that page's surface", () => {
    const root = mount(DOCX);
    const paragraph = root.querySelectorAll("section.docx p")[2];
    const text = paragraph?.firstChild;
    if (!text) throw new Error("Missing text.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);

    const containing = surfaces(root).filter((surface) =>
      surface.root.contains(range.commonAncestorContainer),
    );

    expect(containing.map((surface) => surface.segment)).toEqual(["page:2"]);
  });
});
