import { describe, expect, it } from "vitest";
import { resolveMarkdownImageSrc } from "../markdownImage";

describe("resolveMarkdownImageSrc", () => {
  it("passes remote and inline-data URLs through unchanged", () => {
    expect(resolveMarkdownImageSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(resolveMarkdownImageSrc("http://example.com/a.png")).toBe(
      "http://example.com/a.png",
    );
    expect(resolveMarkdownImageSrc("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(resolveMarkdownImageSrc("blob:pine/1234")).toBe("blob:pine/1234");
    expect(resolveMarkdownImageSrc("//cdn.example.com/a.png")).toBe(
      "//cdn.example.com/a.png",
    );
  });

  it("rewrites absolute POSIX paths to the attachment protocol", () => {
    expect(resolveMarkdownImageSrc("/Users/kw/docs/diagram.png")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2Fdocs%2Fdiagram.png",
    );
    expect(resolveMarkdownImageSrc("/Users/kw/docs/a%20b.png")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2Fdocs%2Fa%20b.png",
    );
  });

  it("rewrites Windows absolute paths to the attachment protocol", () => {
    expect(resolveMarkdownImageSrc("C:\\Users\\kw\\a.png")).toBe(
      "pine-attachment://local/?p=C%3A%5CUsers%5Ckw%5Ca.png",
    );
    expect(resolveMarkdownImageSrc("C:/Users/kw/a.png")).toBe(
      "pine-attachment://local/?p=C%3A%2FUsers%2Fkw%2Fa.png",
    );
    expect(resolveMarkdownImageSrc("C:/Users/kw/a%20b.png")).toBe(
      "pine-attachment://local/?p=C%3A%2FUsers%2Fkw%2Fa%20b.png",
    );
  });

  it("keeps invalid percent-escapes for absolute local paths", () => {
    expect(resolveMarkdownImageSrc("/Users/kw/100% done.png")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2F100%25%20done.png",
    );
  });

  it("decodes file:// URLs into the attachment protocol", () => {
    expect(resolveMarkdownImageSrc("file:///Users/kw/a%20b.png")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2Fa%20b.png",
    );
    expect(resolveMarkdownImageSrc("file:///C:/Users/kw/a.png")).toBe(
      "pine-attachment://local/?p=C%3A%2FUsers%2Fkw%2Fa.png",
    );
  });

  it("leaves relative paths unchanged (no base document in chat)", () => {
    expect(resolveMarkdownImageSrc("./images/a.png")).toBe("./images/a.png");
    expect(resolveMarkdownImageSrc("images/a.png")).toBe("images/a.png");
  });

  it("keeps the document's owner and grants when resolving relative images", () => {
    const documentUrl =
      "pine-project-media://preview/?owner=7&presented=1&path=%2FReadings%2F中文译本.md";
    const image = new URL(
      resolveMarkdownImageSrc("figures-dd/案例%20配图.png", documentUrl),
    );
    expect(Object.fromEntries(image.searchParams)).toEqual({
      owner: "7",
      presented: "1",
      path: "/Readings/中文译本.md",
      markdownImage: "figures-dd/案例%20配图.png",
    });
    expect(
      resolveMarkdownImageSrc("https://example.com/a.png", documentUrl),
    ).toBe("https://example.com/a.png");
  });

  it("returns empty sources unchanged", () => {
    expect(resolveMarkdownImageSrc("")).toBe("");
  });
});
