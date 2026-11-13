import { describe, expect, it } from "vitest";
import {
  advanceThinkingBlocks,
  currentThinkingBlock,
  type ThinkingBlockState,
} from "../thinkingBlocks";

function split(text: string) {
  const state = advanceThinkingBlocks(undefined, text);
  return {
    state,
    block: currentThinkingBlock(state, text),
  };
}

/** The block index and current block after each line boundary. */
function blocksOf(text: string): string[] {
  const seen: string[] = [];
  let state: ThinkingBlockState | undefined;
  for (let end = 1; end <= text.length; end++) {
    const prefix = text.slice(0, end);
    state = advanceThinkingBlocks(state, prefix);
    const block = currentThinkingBlock(state, prefix);
    if (seen.length <= state.blockIndex) seen.push(block);
    else seen[state.blockIndex] = block;
  }
  return seen;
}

describe("thinking block splitter", () => {
  it("splits paragraphs on blank lines, counting each boundary once", () => {
    const { state, block } = split("First.\n\nSecond.\n \t\n\n\nThird.");
    expect(state.blockIndex).toBe(2);
    expect(block).toBe("Third.");
    expect(blocksOf("First.\n\nSecond.\n \t\n\n\nThird.")).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
  });

  it("starts a block at a heading and keeps the lines that follow it", () => {
    const text = "Intro line.\n## Plan\nStep one.\nStep two.";
    const { state, block } = split(text);
    expect(state.blockIndex).toBe(1);
    expect(block).toBe("## Plan\nStep one.\nStep two.");
    expect(split("# Title\nBody.").state.blockIndex).toBe(0);
    expect(split("Intro.\n#hashtag\nBody.").state.blockIndex).toBe(0);
  });

  it("ignores leading blank lines", () => {
    const { state, block } = split("\n\n  \nFirst.");
    expect(state.blockIndex).toBe(0);
    expect(block).toBe("First.");
  });

  it.each([
    ["backtick", "Look:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```"],
    ["tilde", "Look:\n\n~~~\na\n\n# not a heading\n~~~"],
    ["longer closing fence", "Look:\n\n````\na\n```\n\nb\n`````"],
    ["indented fence in a list", "Look:\n\n- item\n  ```\n  a\n\n  b\n  ```"],
    ["display math", "Look:\n\n$$\na = b\n\nc = d\n$$"],
  ])("keeps a %s block whole across blank lines", (_name, text) => {
    // The closing line closes the fence once it is complete.
    const { state, block } = split(`${text}\n`);
    expect(state.blockIndex).toBe(1);
    expect(block).toBe(text.slice("Look:\n\n".length));
    expect(state.fence).toBeUndefined();
  });

  it("keeps everything after an unclosed fence in one block", () => {
    const text = "Look:\n\n```\na\n\nb\n\nc";
    const { state, block } = split(text);
    expect(state.blockIndex).toBe(1);
    expect(block).toBe("```\na\n\nb\n\nc");
    expect(state.fence).toEqual({ char: "`", length: 3 });
  });

  it("splits a paragraph that follows a closed fence", () => {
    const { state, block } = split("```\na\n\nb\n```\n\nAfter.");
    expect(state.blockIndex).toBe(1);
    expect(block).toBe("After.");
  });

  it("keeps a tight list whole and splits a loose list per item", () => {
    expect(split("- a\n- b\n- c").state.blockIndex).toBe(0);
    const loose = split("- a\n\n- b\n\n- c");
    expect(loose.state.blockIndex).toBe(2);
    expect(loose.block).toBe("- c");
  });

  it("gives the same result fed in characters, chunks or at once", () => {
    const text = [
      "Intro paragraph that wraps\nonto a second line.",
      "",
      "## Heading",
      "Body under heading.",
      "",
      "```js",
      "x();",
      "",
      "y();",
      "```",
      "",
      "$$",
      "a",
      "",
      "$$",
      "",
      "- one",
      "- two",
      "",
      "Closing words.",
    ].join("\n");
    const oneShot = advanceThinkingBlocks(undefined, text);

    let byChar: ThinkingBlockState | undefined;
    for (let end = 1; end <= text.length; end++)
      byChar = advanceThinkingBlocks(byChar, text.slice(0, end));

    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    let byChunk: ThinkingBlockState | undefined;
    for (let end = 0; end < text.length;) {
      end = Math.min(text.length, end + 1 + Math.floor(random() * 9));
      byChunk = advanceThinkingBlocks(byChunk, text.slice(0, end));
    }

    for (const state of [byChar, byChunk]) {
      expect(state?.blockStart).toBe(oneShot.blockStart);
      expect(state?.blockIndex).toBe(oneShot.blockIndex);
    }
    expect(oneShot.blockIndex).toBe(5);
    expect(currentThinkingBlock(oneShot, text)).toBe("Closing words.");
  });

  it("moves to a new paragraph at its first character and does not split it again", () => {
    let state = advanceThinkingBlocks(undefined, "One.\n\n");
    expect(state.blockIndex).toBe(0);
    state = advanceThinkingBlocks(state, "One.\n\nT");
    expect(state.blockIndex).toBe(1);
    expect(currentThinkingBlock(state, "One.\n\nT")).toBe("T");
    state = advanceThinkingBlocks(state, "One.\n\nTwo.\nStill two.");
    expect(state.blockIndex).toBe(1);
    expect(currentThinkingBlock(state, "One.\n\nTwo.\nStill two.")).toBe(
      "Two.\nStill two.",
    );
  });

  it("resumes an append from the last line instead of rescanning", () => {
    const text = "One.\n\nTwo.\n";
    const state = advanceThinkingBlocks(undefined, text);
    // A rescan from the start would recount this index from zero.
    const marked = { ...state, blockIndex: 99 };
    const next = advanceThinkingBlocks(marked, `${text}\nThree.`);
    expect(next.blockIndex).toBe(100);
    expect(next.lineStart).toBe(text.length + 1);
  });

  it("rescans when the text shrinks or changes before the resume point", () => {
    const state = advanceThinkingBlocks(undefined, "One.\n\nTwo.\n");
    const marked = { ...state, blockIndex: 99 };

    const shorter = advanceThinkingBlocks(marked, "One.\n");
    expect(shorter.blockIndex).toBe(0);
    expect(currentThinkingBlock(shorter, "One.\n")).toBe("One.");

    const rewritten = "One!\nTwo.\nThree.";
    const changed = advanceThinkingBlocks(marked, rewritten);
    expect(changed.blockIndex).toBe(0);
    expect(currentThinkingBlock(changed, rewritten)).toBe(rewritten);
  });

  it("trims trailing whitespace from the current block", () => {
    const { block } = split("One.\n\nTwo.  \n\n");
    expect(block).toBe("Two.");
  });
});
