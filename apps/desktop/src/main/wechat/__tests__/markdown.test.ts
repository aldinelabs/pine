// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  agentMarkdown,
  blocks,
  bullets,
  closeOpenFence,
  code,
  codeBlock,
  cutMarkdown,
  escapeInline,
  neutraliseMarkdownLine,
  paginateMarkdown,
  quote,
} from "../markdown";
import { parseCommand } from "../parseCommand";
import { codePointLength } from "../text";

/** Fence lines balance: every opened fence is closed. */
function fencesBalanced(text: string): boolean {
  let open: string | undefined;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (open) {
      if (/^(`{3,}|~{3,})$/.test(trimmed) && trimmed.startsWith(open))
        open = undefined;
    } else {
      const match = /^(`{3,}|~{3,})/.exec(trimmed);
      if (match) open = match[1];
    }
  }
  return open === undefined;
}

describe("inline helpers", () => {
  it("escapes the characters that start inline Markdown", () => {
    expect(escapeInline("a*b_c`d~e[f]g<h&i\\j")).toBe(
      "a\\*b\\_c\\`d\\~e\\[f\\]g\\<h\\&i\\\\j",
    );
    expect(escapeInline("修登录页 .y 12")).toBe("修登录页 .y 12");
    expect(escapeInline("my_file_v2.md")).toBe("my\\_file\\_v2.md");
  });

  it("makes one-line code spans without backticks", () => {
    expect(code("rm `x`\nnow")).toBe("`rm 'x' now`");
    expect(code("  ")).toBe("");
  });

  it("picks a fence longer than any backtick run inside", () => {
    expect(codeBlock("ls")).toBe("```\nls\n```");
    expect(codeBlock("a\n```\nb", "sh")).toBe("````sh\na\n```\nb\n````");
    const nested = codeBlock("x\n````\ny\n");
    expect(nested.startsWith("`````\n")).toBe(true);
    expect(nested.endsWith("\n`````")).toBe(true);
    expect(nested.split("\n")).toEqual(["`````", "x", "````", "y", "`````"]);
  });

  it("builds quotes, bullets and blocks", () => {
    expect(quote("a", false, undefined, "", "b")).toBe("> a\n> b");
    expect(quote()).toBe("");
    expect(bullets(["a", "b"])).toBe("- a\n- b");
    expect(blocks("a", false, "", "b")).toBe("a\n\nb");
  });
});

describe("neutraliseMarkdownLine", () => {
  it("guards a dot after Markdown containers and inline markers", () => {
    expect(neutraliseMarkdownLine("- .y 12")).toBe("- › .y 12");
    expect(neutraliseMarkdownLine("> .d 3")).toBe("> › .d 3");
    expect(neutraliseMarkdownLine("## .x")).toBe("## › .x");
    expect(neutraliseMarkdownLine("**.y 12**")).toBe("› **.y 12**");
    expect(neutraliseMarkdownLine("1. .y 9")).toBe("1. › .y 9");
    expect(neutraliseMarkdownLine("`.r`")).toBe("› `.r`");
    expect(neutraliseMarkdownLine("。d 98")).toBe("› 。d 98");
  });

  it("guards lines that only render as dot-led", () => {
    expect(neutraliseMarkdownLine("\\.y 6")).toBe("› \\.y 6");
    expect(neutraliseMarkdownLine("&#46;y 7")).toBe("› &#46;y 7");
    expect(neutraliseMarkdownLine("&period;y 7")).toBe("› &period;y 7");
    expect(neutraliseMarkdownLine("&#X2E;y 7")).toBe("› &#X2E;y 7");
    expect(neutraliseMarkdownLine("&#12290;d 3")).toBe("› &#12290;d 3");
    expect(neutraliseMarkdownLine("- [ ] .y 5")).toBe("- [ ] › .y 5");
    expect(neutraliseMarkdownLine("* [x] \\.y 5")).toBe("* [x] › \\.y 5");
    expect(neutraliseMarkdownLine("[.y 4](https://x)")).toBe(
      "› [.y 4](https://x)",
    );
    expect(neutraliseMarkdownLine("<b>.y 4</b>")).toBe("› <b>.y 4</b>");
  });

  it("leaves other lines alone and keeps indentation", () => {
    expect(neutraliseMarkdownLine("Ready at 1.5 s")).toBe("Ready at 1.5 s");
    expect(neutraliseMarkdownLine("  - nested")).toBe("  - nested");
    expect(neutraliseMarkdownLine("    .y 12")).toBe("    › .y 12");
    expect(neutraliseMarkdownLine("- › .y 12")).toBe("- › .y 12");
  });
});

describe("agentMarkdown", () => {
  it("turns headings into bold lines", () => {
    expect(agentMarkdown("# Plan\n\n## Steps ##\ntext", "en")).toBe(
      "**Plan**\n\n**Steps**\ntext",
    );
  });

  it("turns tables into rows", () => {
    expect(
      agentMarkdown("| a | b |\n| --- | :-: |\n| 1 | 2 |\n\nafter", "en"),
    ).toBe("a · b\n1 · 2\n\nafter");
  });

  it("keeps image alt text only", () => {
    expect(agentMarkdown("see ![a chart](https://x/y.png) here", "en")).toBe(
      "see a chart here",
    );
  });

  it("replaces an openui block with the placeholder", () => {
    const text = "before\n\n```openui\n<x/>\n```\n\nafter";
    expect(agentMarkdown(text, "zh")).toBe(
      "before\n\n【这里是一段交互内容，请在 Pine 中查看】\n\nafter",
    );
    expect(agentMarkdown(text, "en")).toContain(
      "[Interactive content here. Open Pine to see it.]",
    );
  });

  it("closes an unterminated fence", () => {
    const text = agentMarkdown("run:\n```sh\nmake", "en");
    expect(text).toBe("run:\n```sh\nmake\n```");
    expect(fencesBalanced(text)).toBe(true);
    expect(agentMarkdown("~~~~\nx", "en")).toBe("~~~~\nx\n~~~~");
  });

  it("puts a blank line before a setext underline", () => {
    expect(agentMarkdown("para\n---\nnext", "en")).toBe("para\n\n---\nnext");
    expect(agentMarkdown("para\n===", "en")).toBe("para\n\n===");
  });

  it("escapes HTML blocks that only end at a closing tag", () => {
    expect(agentMarkdown("<pre>\nx", "en")).toBe("\\<pre>\nx");
    expect(agentMarkdown("  <!-- note", "en")).toBe("  \\<!-- note");
    expect(agentMarkdown("<b>bold</b>", "en")).toBe("<b>bold</b>");
  });

  it("guards dot-led lines in lists, quotes and fences", () => {
    const input = [
      ".y 12",
      "- .y 12",
      "> .d 13",
      "* **.x**",
      "```",
      ".k 2",
      "```",
      "# .u 3",
    ].join("\n");
    const text = agentMarkdown(input, "en");
    for (const line of text.split("\n")) {
      expect(parseCommand(line).kind).toBe("message");
      const visible = line
        .replace(/^\s*(?:[-*+]\s+|>\s?|#{1,6}\s+)*/, "")
        .replace(/^[*_`~]+/, "");
      expect(/^[.。．｡]/.test(visible)).toBe(false);
    }
    expect(text).toContain("- › .y 12");
    expect(text).toContain("> › .d 13");
    expect(text).toContain("› .k 2");
  });

  it("drops invisible characters and collapses blank lines", () => {
    expect(agentMarkdown("\n\n a\u0007\u202e\u0001b\n\n\n\nc  \n", "en")).toBe(
      " ab\n\nc",
    );
  });
});

describe("cutMarkdown", () => {
  it("leaves text that fits", () => {
    expect(cutMarkdown("short", 10)).toEqual({ text: "short", cut: false });
  });

  it("closes a fence opened in a list item at the item's indent", () => {
    const markdown = `1. Install:\n   \`\`\`bash\n${"   npm i pkg\n".repeat(40)}   \`\`\``;
    const { text } = cutMarkdown(markdown, 120);
    expect(codePointLength(text)).toBeLessThanOrEqual(120);
    expect(text.endsWith("…\n   ```")).toBe(true);
    expect(closeOpenFence("1. a\n   ```\n   b")).toBe(
      "1. a\n   ```\n   b\n   ```",
    );
    expect(agentMarkdown("- a\n  ~~~\n  b", "en")).toBe(
      "- a\n  ~~~\n  b\n  ~~~",
    );
  });

  it("cuts at a boundary and ends with an ellipsis", () => {
    const { text, cut } = cutMarkdown("word ".repeat(100), 50);
    expect(cut).toBe(true);
    expect(codePointLength(text)).toBeLessThanOrEqual(50);
    expect(text.endsWith("…")).toBe(true);
  });

  it("closes a fence the cut lands in", () => {
    const markdown = `intro\n\n\`\`\`ts\n${"const x = 1;\n".repeat(50)}\`\`\``;
    const { text } = cutMarkdown(markdown, 120);
    expect(codePointLength(text)).toBeLessThanOrEqual(120);
    expect(text.endsWith("…\n```")).toBe(true);
    expect(fencesBalanced(text)).toBe(true);
  });
});

describe("paginateMarkdown", () => {
  it("closes and reopens a fence that runs across pages", () => {
    const code = Array.from({ length: 120 }, (_, i) => `line ${i} ok`).join(
      "\n",
    );
    const markdown = `Here:\n\n\`\`\`python\n${code}\n\`\`\`\n\nDone.`;
    const max = 600;
    const pages = paginateMarkdown(markdown, max);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    for (const page of pages) {
      expect(codePointLength(page)).toBeLessThanOrEqual(max);
      expect(fencesBalanced(page)).toBe(true);
    }
    expect(pages[1]?.startsWith("```python\n")).toBe(true);
    expect(pages.at(-1)).toContain("Done.");
  });

  it("reopens a list-item fence at its indent", () => {
    const code = Array.from({ length: 120 }, (_, i) => `   line ${i} ok`).join(
      "\n",
    );
    const pages = paginateMarkdown(
      `1. Run:\n   \`\`\`sh\n${code}\n   \`\`\``,
      600,
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages[0]?.endsWith("\n   ```")).toBe(true);
    expect(pages[1]?.startsWith("   ```sh\n")).toBe(true);
    expect(pages[1]?.endsWith("\n   ```")).toBe(true);
  });

  it("guards the first line of every page", () => {
    const markdown = Array.from({ length: 200 }, () => "a .y 97").join(" ");
    for (const page of paginateMarkdown(markdown, 100))
      expect(parseCommand(page.split("\n")[0] ?? "").kind).toBe("message");
  });

  it("closes an open fence in closeOpenFence only", () => {
    expect(closeOpenFence("a\n```\nb")).toBe("a\n```\nb\n```");
    expect(closeOpenFence("a\n```\nb\n```")).toBe("a\n```\nb\n```");
  });
});
