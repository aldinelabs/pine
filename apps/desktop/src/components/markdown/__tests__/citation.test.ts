import { describe, expect, it } from "vitest";
import { parseMarkdownCitations } from "../citation";

describe("parseMarkdownCitations", () => {
  it("reads titled and bare web-source definitions", () => {
    const citations = parseMarkdownCitations(
      [
        "正文[^a][^2]",
        "",
        '[^a]: [页面标题](https://www.example.com/p "t")',
        "[^2]: <https://docs.example.org/x>",
      ].join("\n"),
    );
    expect(citations.get("a")).toEqual({
      href: "https://www.example.com/p",
      hostname: "example.com",
      favicon: "https://icons.duckduckgo.com/ip3/www.example.com.ico",
      title: "页面标题",
    });
    expect(citations.get("2")).toEqual({
      href: "https://docs.example.org/x",
      hostname: "docs.example.org",
      favicon: "https://icons.duckduckgo.com/ip3/docs.example.org.ico",
    });
  });

  it("ignores prose footnotes and non-http sources", () => {
    const citations = parseMarkdownCitations(
      [
        "[^1]: 这是一段注释，见 https://example.com",
        "[^2]: [邮件](mailto:a@example.com)",
        "[^3]: javascript:alert(1)",
      ].join("\n"),
    );
    expect(citations.size).toBe(0);
  });
});
