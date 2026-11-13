import { describe, expect, it } from "vitest";
import { parseMarkdownCitations, shareMarkdownCitations } from "../citation";

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

describe("shareMarkdownCitations", () => {
  const source = [
    "[^1]: [One](https://one.example.com/a)",
    "[^2]: https://two.example.com/b",
  ].join("\n");

  it("returns the previous map when nothing changed", () => {
    const previous = parseMarkdownCitations(source);
    expect(
      shareMarkdownCitations(previous, parseMarkdownCitations(source)),
    ).toBe(previous);
  });

  it("keeps unchanged citations and takes changed or new ones", () => {
    const previous = parseMarkdownCitations(source);
    const next = parseMarkdownCitations(
      [
        "[^1]: [One](https://one.example.com/a)",
        "[^2]: [Two](https://two.example.com/b)",
        "[^3]: https://three.example.com/c",
      ].join("\n"),
    );
    const shared = shareMarkdownCitations(previous, next);
    expect(shared).not.toBe(previous);
    expect(shared.get("1")).toBe(previous.get("1"));
    expect(shared.get("2")).toBe(next.get("2"));
    expect(shared.get("2")?.title).toBe("Two");
    expect(shared.get("3")).toBe(next.get("3"));
  });

  it("drops a citation that disappeared", () => {
    const previous = parseMarkdownCitations(source);
    const shared = shareMarkdownCitations(
      previous,
      parseMarkdownCitations("[^1]: [One](https://one.example.com/a)"),
    );
    expect(shared).not.toBe(previous);
    expect([...shared.keys()]).toEqual(["1"]);
    expect(shared.get("1")).toBe(previous.get("1"));
  });

  it("uses the new map when there is no previous one", () => {
    const next = parseMarkdownCitations(source);
    expect(shareMarkdownCitations(undefined, next)).toBe(next);
  });
});
