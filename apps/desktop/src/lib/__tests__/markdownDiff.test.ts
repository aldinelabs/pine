import { getMarkdown } from "markstream-vue";
import { describe, expect, it } from "vitest";
import { configurePineMarkdown } from "@/components/markdown/configureMarkdown";
import { diffMarkdown, diffWords, markdownBlocks } from "../markdownDiff";

const md = configurePineMarkdown(getMarkdown("markdown-diff-test"));

describe("markdownBlocks", () => {
  it("splits top-level lists into items and keeps other blocks whole", () => {
    const blocks = markdownBlocks(
      md,
      "# Title\n\nText\n\n- a\n- b\n  - c\n\n| a |\n|---|\n| 1 |\n",
    );
    expect(blocks.map(({ kind, start, end }) => [kind, start, end])).toEqual([
      ["heading", 0, 1],
      ["paragraph", 2, 3],
      ["listItem", 4, 5],
      ["listItem", 5, 7],
      ["other", 8, 11],
    ]);
    expect(blocks[0].level).toBe(1);
  });
});

describe("diffWords", () => {
  it("marks the words that changed, Chinese included", () => {
    const { parts, kept } = diffWords(
      "开业活动细化为 3 项",
      "开业活动细化为 4 项",
    );
    expect(parts.filter((part) => part.type !== "same")).toEqual([
      { type: "removed", text: "3" },
      { type: "added", text: "4" },
    ]);
    expect(kept).toBeGreaterThan(0.8);
  });
});

describe("diffMarkdown", () => {
  it("shows unchanged runs as Markdown and edits as word changes", () => {
    const before =
      "# Plan\n\nIntro stays.\n\nBudget is 30 thousand.\n\n- one\n- two\n";
    const after =
      "# Plan\n\nIntro stays.\n\nBudget is 35 thousand.\n\n- one\n- two\n- three\n";

    expect(diffMarkdown(md, before, after)).toEqual([
      { type: "same", source: "# Plan\n\nIntro stays." },
      {
        type: "changed",
        kind: "paragraph",
        parts: [
          { type: "same", text: "Budget is " },
          { type: "removed", text: "30" },
          { type: "added", text: "35" },
          { type: "same", text: " thousand." },
        ],
      },
      { type: "same", source: "- one\n- two" },
      { type: "added", source: "- three" },
    ]);
  });

  it("shows a rewritten block as removed and added", () => {
    expect(
      diffMarkdown(
        md,
        "Old text entirely.\n",
        "Something completely different.\n",
      ),
    ).toEqual([
      { type: "removed", source: "Old text entirely." },
      { type: "added", source: "Something completely different." },
    ]);
  });

  it("replaces tables and code whole, and keeps a list item's marker", () => {
    const segments = diffMarkdown(
      md,
      "1. first item here\n\n```js\na()\n```\n",
      "1. first item there\n\n```js\nb()\n```\n",
    );
    expect(segments[0]).toMatchObject({
      type: "changed",
      kind: "listItem",
      marker: "1.",
    });
    expect(segments.slice(1)).toEqual([
      { type: "removed", source: "```js\na()\n```" },
      { type: "added", source: "```js\nb()\n```" },
    ]);
  });
});
