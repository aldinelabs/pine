import { afterEach, describe, expect, it } from "vitest";
import {
  documentPreviewSelection,
  filePreviewRangeSelection,
  filePreviewSelection,
} from "../filePreviewSelection";

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function select(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

describe("file preview selections", () => {
  it("captures rendered document text without pretending it has source locations", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>First line<br>Second line</p>";
    document.body.append(root);
    const paragraph = root.querySelector("p")!;
    select(paragraph.firstChild!, 0, paragraph.lastChild!, 11);

    expect(documentPreviewSelection(root, "Selected content")).toEqual({
      startLine: 1,
      endLine: 1,
      label: "Selected content",
      text: "First lineSecond line",
    });
  });

  it.each(["\n", "\r\n", "\r"])(
    "counts source lines with %j line endings and excludes the next line at offset zero",
    (newline) => {
      const root = document.createElement("div");
      const code = document.createElement("code");
      const pre = document.createElement("pre");
      pre.append(code);
      root.append(pre);
      document.body.append(root);
      const source = ["first", "second", "third"].join(newline);
      code.textContent = source;
      const text = code.firstChild!;
      const start = "first".length + newline.length;
      select(text, start, text, start + "second".length + newline.length);
      expect(filePreviewSelection(root, source)).toEqual({
        startLine: 2,
        endLine: 2,
        text: `second${newline}`,
      });
    },
  );

  it("ignores collapsed, unrelated, and gutter selections", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span aria-hidden="true">1</span><pre><code>first</code></pre>';
    const outside = document.createTextNode("outside");
    document.body.append(root, outside);
    const code = root.querySelector("code")!.firstChild!;
    select(code, 2, code, 2);
    expect(filePreviewSelection(root, "first")).toBeUndefined();
    select(outside, 0, outside, 3);
    expect(filePreviewSelection(root, "first")).toBeUndefined();
    select(root.firstChild!.firstChild!, 0, code, 3);
    expect(filePreviewSelection(root, "first")).toBeUndefined();
  });

  it("maps formatted text to the correct line within a multiline Markdown block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="markdown-renderer"><div data-node-index="0"><p>first <strong>bold</strong> line.\nsecond <em>bold</em> line.</p></div></div>';
    document.body.append(root);
    const text = root.querySelector("em")!.firstChild!;
    select(text, 0, text, 4);
    expect(
      filePreviewSelection(root, "first **bold** line.\nsecond *bold* line.", [
        { type: "paragraph", raw: "", sourceMap: { startLine: 0, endLine: 2 } },
      ]),
    ).toEqual({ startLine: 2, endLine: 2, text: "bold" });
  });
});

describe("file preview range selections", () => {
  it("maps an arbitrary range in code without reading the window selection", () => {
    const root = document.createElement("div");
    root.innerHTML = "<pre><code>first\nsecond\nthird</code></pre>";
    document.body.append(root);
    const text = root.querySelector("code")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, "first\nsecond\nth".length);
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(
      filePreviewRangeSelection(root, range, "first\nsecond\nthird"),
    ).toEqual({ startLine: 1, endLine: 3, text: "rst\nsecond\nth" });
  });

  it("maps an arbitrary range in rendered Markdown and rejects outside ranges", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="markdown-renderer"><div data-node-index="0"><h1>Title</h1></div><div data-node-index="1"><p>Body <button>copy</button>text</p></div></div>';
    const outside = document.createTextNode("outside");
    document.body.append(root, outside);
    const nodes = [
      { type: "heading", raw: "", sourceMap: { startLine: 0, endLine: 1 } },
      { type: "paragraph", raw: "", sourceMap: { startLine: 2, endLine: 3 } },
    ];
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("p")!);
    expect(
      filePreviewRangeSelection(root, range, "# Title\n\nBody text", nodes),
    ).toEqual({ startLine: 3, endLine: 3, text: "Body copytext" });

    range.selectNodeContents(outside);
    expect(
      filePreviewRangeSelection(root, range, "# Title\n\nBody text", nodes),
    ).toBeUndefined();
  });
});
