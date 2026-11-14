import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANNOTATION_CONTEXT_LENGTH,
  annotationText,
  annotationTextNodes,
  createTextAnchor,
  locateTextAnchor,
  rangeFromOffsets,
  rangeOffsets,
} from "../annotationAnchors";

const GUTTER = ".gutter";

function mount(html: string, doc: Document = document): HTMLElement {
  const root = doc.createElement("div");
  root.innerHTML = html;
  doc.body.append(root);
  return root;
}

function codeLines(lines: string[]): string {
  return lines
    .map(
      (line, index) =>
        `<div class="line"><span class="gutter">${index + 1}</span><span>${line}\n</span></div>`,
    )
    .join("");
}

function rangeOver(
  root: HTMLElement,
  search: string,
  occurrence = 0,
  excluded?: string,
): Range {
  const text = annotationText(root, excluded);
  let start = -1;
  for (let count = 0; count <= occurrence; count += 1)
    start = text.indexOf(search, start + 1);
  const range = rangeFromOffsets(
    root,
    { start, end: start + search.length },
    excluded,
  );
  if (!range) throw new Error(`no range for ${search}`);
  return range;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("annotation text", () => {
  it("joins text nodes in document order", () => {
    const root = mount("<p>Hello <b>bold</b> world</p><p>Again</p>");
    expect(annotationText(root)).toBe("Hello bold worldAgain");
    expect(annotationTextNodes(root)).toHaveLength(4);
  });

  it("skips excluded subtrees", () => {
    const root = mount(codeLines(["alpha", "beta"]));
    expect(annotationText(root, GUTTER)).toBe("alpha\nbeta\n");
  });
});

describe("offsets", () => {
  it("round-trips through a range", () => {
    const root = mount("<p>Hello <b>bold</b> world</p>");
    const range = rangeFromOffsets(root, { start: 3, end: 13 });
    expect(range?.toString()).toBe("lo bold wo");
    expect(rangeOffsets(root, range!)).toEqual({ start: 3, end: 13 });
  });

  it("handles a range ending at the very end", () => {
    const root = mount("<p>abc</p><p>def</p>");
    const range = rangeFromOffsets(root, { start: 3, end: 6 });
    expect(range?.toString()).toBe("def");
    expect(rangeOffsets(root, range!)).toEqual({ start: 3, end: 6 });
  });

  it("rejects empty or out-of-bounds offsets", () => {
    const root = mount("<p>abc</p>");
    expect(rangeFromOffsets(root, { start: 2, end: 2 })).toBeUndefined();
    expect(rangeFromOffsets(root, { start: 1, end: 9 })).toBeUndefined();
    expect(rangeFromOffsets(root, { start: -1, end: 1 })).toBeUndefined();
  });

  it("maps element boundaries to text positions", () => {
    const root = mount("<p>abc</p><p>def</p>");
    const range = document.createRange();
    range.setStart(root, 1);
    range.setEnd(root, 2);
    expect(rangeOffsets(root, range)).toEqual({ start: 3, end: 6 });
  });

  it("moves boundaries in excluded gutters to the nearest included text", () => {
    const root = mount(codeLines(["alpha", "beta", "gamma"]));
    const gutters = root.querySelectorAll(GUTTER);
    const range = document.createRange();
    range.setStart(gutters[0].firstChild!, 0);
    range.setEnd(gutters[2].firstChild!, 1);
    expect(rangeOffsets(root, range, GUTTER)).toEqual({ start: 0, end: 11 });
    const back = rangeFromOffsets(root, { start: 0, end: 11 }, GUTTER)!;
    // The DOM range spans the gutter between lines; the offsets skip it.
    expect(back.toString()).toBe("alpha\n2beta\n");
    expect(rangeOffsets(root, back, GUTTER)).toEqual({ start: 0, end: 11 });
  });

  it("returns undefined when only excluded text is selected", () => {
    const root = mount(codeLines(["alpha"]));
    const gutter = root.querySelector(GUTTER)!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(gutter);
    expect(rangeOffsets(root, range, GUTTER)).toBeUndefined();
  });

  it("clamps boundaries outside root", () => {
    const before = mount("<p>before</p>");
    const root = mount("<p>inside</p>");
    const after = mount("<p>after</p>");
    const range = document.createRange();
    range.setStart(before.firstChild!.firstChild!, 2);
    range.setEnd(after.firstChild!.firstChild!, 2);
    expect(rangeOffsets(root, range)).toEqual({ start: 0, end: 6 });
  });
});

describe("createTextAnchor", () => {
  it("records exact text with surrounding context", () => {
    const filler = "x".repeat(40);
    const root = mount(`<p>${filler}needle${filler}</p>`);
    const anchor = createTextAnchor(root, rangeOver(root, "needle"));
    expect(anchor).toEqual({
      start: 40,
      end: 46,
      exact: "needle",
      prefix: "x".repeat(ANNOTATION_CONTEXT_LENGTH),
      suffix: "x".repeat(ANNOTATION_CONTEXT_LENGTH),
    });
  });

  it("ignores blank selections", () => {
    const root = mount("<p>a   b</p>");
    const range = rangeFromOffsets(root, { start: 1, end: 4 })!;
    expect(createTextAnchor(root, range)).toBeUndefined();
  });
});

describe("locateTextAnchor", () => {
  it("finds an anchor at its offsets", () => {
    const root = mount(codeLines(["one", "two", "three"]));
    const anchor = createTextAnchor(
      root,
      rangeOver(root, "two", 0, GUTTER),
      GUTTER,
    )!;
    const located = locateTextAnchor(root, anchor, GUTTER);
    expect(located?.anchor).toEqual(anchor);
    expect(located?.range.toString()).toBe("two");
  });

  it("finds shifted text with new offsets", () => {
    const lines = ["const a = 1;", "const b = 2;", "return a + b;"];
    const root = mount(codeLines(lines));
    const anchor = createTextAnchor(
      root,
      rangeOver(root, "const b", 0, GUTTER),
      GUTTER,
    )!;
    root.innerHTML = codeLines(["// header", "", ...lines]);
    const located = locateTextAnchor(root, anchor, GUTTER)!;
    expect(located.anchor.exact).toBe("const b");
    expect(located.anchor.start).toBe(anchor.start + "// header\n\n".length);
    expect(located.anchor.prefix).toBe(
      "// header\n\nconst a = 1;\n".slice(-ANNOTATION_CONTEXT_LENGTH),
    );
    expect(located.range.toString()).toBe("const b");
  });

  it("picks the repeated occurrence whose context matches", () => {
    const root = mount(codeLines(["let value = 1;", "let value = 2;"]));
    const anchor = createTextAnchor(
      root,
      rangeOver(root, "let value", 1, GUTTER),
      GUTTER,
    )!;
    // A long line between them leaves the first occurrence nearer the old start.
    root.innerHTML = codeLines([
      "let value = 1;",
      "pad ".repeat(10),
      "let value = 2;",
    ]);
    const located = locateTextAnchor(root, anchor, GUTTER)!;
    const text = annotationText(root, GUTTER);
    expect(located.anchor.start).toBe(text.lastIndexOf("let value"));
    expect(located.anchor.suffix.startsWith(" = 2;")).toBe(true);
  });

  it("breaks ties by distance to the old start", () => {
    const root = mount("<p>ab ab ab ab</p>");
    const anchor = {
      start: 6,
      end: 8,
      exact: "ab",
      prefix: "",
      suffix: "",
    };
    root.innerHTML = "<p>-ab ab ab ab</p>";
    expect(locateTextAnchor(root, anchor)?.anchor.start).toBe(7);
  });

  it("returns undefined once the text is gone", () => {
    const root = mount(codeLines(["keep", "remove me"]));
    const anchor = createTextAnchor(
      root,
      rangeOver(root, "remove me", 0, GUTTER),
      GUTTER,
    )!;
    root.innerHTML = codeLines(["keep"]);
    expect(locateTextAnchor(root, anchor, GUTTER)).toBeUndefined();
  });
});

describe("roots in another document", () => {
  it("works in a separate window's document, like an iframe", () => {
    // happy-dom does not load iframes; a second Window has its own document
    // and Range, which is what an iframe root brings.
    const frame = new Window();
    const doc = frame.document as unknown as Document;
    expect(doc).not.toBe(document);
    const root = mount("<p>Inside <em>the</em> frame</p>", doc);
    const range = doc.createRange();
    range.setStart(root.querySelector("em")!.firstChild!, 0);
    range.setEnd(root.querySelector("p")!.lastChild!, 3);
    expect(rangeOffsets(root, range)).toEqual({ start: 7, end: 13 });
    const anchor = createTextAnchor(root, range)!;
    expect(anchor.exact).toBe("the fr");
    root.querySelector("p")!.prepend("Now ");
    const located = locateTextAnchor(root, anchor)!;
    expect(located.anchor.start).toBe(11);
    expect(located.range.startContainer.ownerDocument).toBe(doc);
    expect(located.range.toString()).toBe("the fr");
    void frame.happyDOM.close();
  });
});
