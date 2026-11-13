import { describe, expect, it } from "vitest";
import {
  createMarkdownBlockView,
  hasDocumentLevelDefinitions,
  markdownFlowJoin,
} from "../markdownBlockView";

describe("createMarkdownBlockView", () => {
  it("splits a segment into blocks with only the tail streaming", () => {
    const view = createMarkdownBlockView();
    const items = view("# Title\n\nFirst paragraph.\n\nSecond", false);
    expect(items.map((item) => item.source)).toEqual([
      "# Title",
      "First paragraph.",
      "Second",
    ]);
    // Blocks completed by this very build still stream until the next one.
    expect(items.map((item) => item.final)).toEqual([false, false, false]);
  });

  it("turns a completed block final one build after it completed", () => {
    const view = createMarkdownBlockView();
    view("One.\n\nTwo", false);
    const next = view("One.\n\nTwo.\n\nThree", false);
    expect(next.map((item) => [item.source, item.final])).toEqual([
      ["One.", true],
      ["Two.", false],
      ["Three", false],
    ]);
  });

  it("keeps a completed block's item once it is final", () => {
    const view = createMarkdownBlockView();
    view("One.\n\nTwo", false);
    const first = view("One.\n\nTwo.\n\nThree", false)[0];
    const later = view("One.\n\nTwo.\n\nThree.\n\nFour", false)[0];
    expect(later).toBe(first);
  });

  it("returns the same items for an unchanged build", () => {
    const view = createMarkdownBlockView();
    const items = view("One.\n\nTwo", false);
    expect(view("One.\n\nTwo", false)).toBe(items);
  });

  it("marks every block final once the segment is final", () => {
    const view = createMarkdownBlockView();
    view("One.\n\nTwo", false);
    const items = view("One.\n\nTwo", true);
    expect(items.every((item) => item.final)).toBe(true);
  });

  it("keeps a fenced code block with blank lines in one block", () => {
    const view = createMarkdownBlockView();
    const items = view(
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter",
      false,
    );
    expect(items.map((item) => item.source)).toEqual([
      "```ts\nconst a = 1;\n\nconst b = 2;\n```",
      "After",
    ]);
  });

  it("keeps a loose list in one block", () => {
    const view = createMarkdownBlockView();
    const items = view("1. One.\n\n2. Two.\n\nAfter", false);
    expect(items.map((item) => item.source)).toEqual([
      "1. One.\n\n2. Two.",
      "After",
    ]);
  });

  it("rebuilds from the start when the text is rewritten", () => {
    const view = createMarkdownBlockView();
    view("One.\n\nTwo.\n\nThree", false);
    const items = view("Other.\n\nText", false);
    expect(items.map((item) => item.source)).toEqual(["Other.", "Text"]);
  });

  it("leaves out an empty trailing block", () => {
    const view = createMarkdownBlockView();
    expect(view("One.\n\n", false).map((item) => item.source)).toEqual([
      "One.",
    ]);
  });
});

describe("markdownFlowJoin", () => {
  it("joins each block with its neighbours", () => {
    expect(markdownFlowJoin(0, 1)).toBeUndefined();
    expect(markdownFlowJoin(0, 3)).toBe("end");
    expect(markdownFlowJoin(1, 3)).toBe("both");
    expect(markdownFlowJoin(2, 3)).toBe("start");
  });
});

describe("hasDocumentLevelDefinitions", () => {
  it("finds footnotes and link reference definitions", () => {
    expect(hasDocumentLevelDefinitions("See this[^1].")).toBe(true);
    expect(
      hasDocumentLevelDefinitions("A [link][ref].\n\n[ref]: https://a.b"),
    ).toBe(true);
    expect(
      hasDocumentLevelDefinitions("A [link](https://a.b) and `[x]`."),
    ).toBe(false);
    expect(hasDocumentLevelDefinitions("- [x] Done\n- [ ] Todo")).toBe(false);
  });
});
