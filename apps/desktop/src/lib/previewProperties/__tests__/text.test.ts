import { describe, expect, it } from "vitest";
import {
  countCharacters,
  countWords,
  frontMatter,
  lineEndings,
  syntaxName,
  textProperties,
} from "../text";

describe("text properties", () => {
  it("names the line endings a file uses", () => {
    expect(lineEndings("a\nb\n")).toBe("LF");
    expect(lineEndings("a\r\nb\r\n")).toBe("CRLF");
    expect(lineEndings("a\rb")).toBe("CR");
    expect(lineEndings("a\r\nb\n")).toBe("Mixed");
    expect(lineEndings("one line")).toBeUndefined();
  });

  it("counts characters as code points and words by language", () => {
    expect(countCharacters("a😀b")).toBe(3);
    expect(countWords("Hello, brave new world.")).toBe(4);
    expect(countWords("我喜欢读书", "zh-CN")).toBeGreaterThan(1);
  });

  it("reads a Markdown front matter title and author list", () => {
    expect(
      frontMatter(
        '---\ntitle: "Field notes"\nauthor:\n  - Ada\n  - Lin\n---\n',
      ),
    ).toEqual({ title: "Field notes", author: "Ada, Lin" });
    expect(frontMatter("---\nauthors: [Ada, 'Lin']\n---\n")).toEqual({
      author: "Ada, Lin",
    });
    expect(frontMatter("# No front matter")).toEqual({});
  });

  it("names the highlighter's language, but not plain text", () => {
    expect(syntaxName("typescript")).toBe("TypeScript");
    expect(syntaxName("text")).toBeUndefined();
  });

  it("lists the properties in order and leaves out absent ones", () => {
    expect(
      textProperties("---\ntitle: Notes\n---\nTwo words\n", {
        syntax: "Markdown",
        markdown: true,
      }),
    ).toEqual([
      { key: "title", value: "Notes" },
      { key: "syntax", value: "Markdown" },
      { key: "words", type: "number", value: 4 },
      { key: "characters", type: "number", value: 31 },
      { key: "lineEndings", value: "LF" },
    ]);
    expect(textProperties("")).toEqual([
      { key: "words", type: "number", value: 0 },
      { key: "characters", type: "number", value: 0 },
    ]);
  });
});
