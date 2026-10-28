import { describe, expect, it } from "vitest";
import {
  SANDBOX_POLICY,
  declaredCharset,
  decodeHtml,
  inlineResources,
  sandboxHtml,
} from "../htmlSandbox";

describe("sandboxHtml", () => {
  it("puts the policy before anything else in the head", () => {
    expect(sandboxHtml("<html><head><title>x</title></head></html>")).toBe(
      `<html><head><meta http-equiv="Content-Security-Policy" content="${SANDBOX_POLICY}"><title>x</title></head></html>`,
    );
    expect(sandboxHtml("<p>bare</p>")).toMatch(
      /^<!doctype html><head><meta http-equiv="Content-Security-Policy"[^>]+><\/head><p>bare<\/p>$/,
    );
  });

  it("blocks the network and scripts", () => {
    expect(SANDBOX_POLICY).toContain("default-src 'none'");
    expect(SANDBOX_POLICY).not.toMatch(/script-src|https?:/);
  });
});

describe("decodeHtml", () => {
  it("honors the declared charset", () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="gbk"><p>'),
      0xc4,
      0xe3,
    ]);
    expect(declaredCharset(bytes)).toBe("gbk");
    expect(decodeHtml(bytes)).toBe('<meta charset="gbk"><p>你');
  });
});

describe("inlineResources", () => {
  it("inlines saved images and the images their styles use", () => {
    const html = inlineResources(
      '<link href="https://x/s.css"><img src="https://x/a.png">',
      [
        {
          url: "https://x/a.png",
          mimeType: "image/png",
          data: new Uint8Array([1]),
        },
        {
          url: "https://x/s.css",
          mimeType: "text/css",
          data: new TextEncoder().encode("b{background:url(https://x/a.png)}"),
        },
      ],
    );
    expect(html).toContain('<img src="data:image/png;base64,AQ==">');
    const css = /href="data:text\/css;base64,([^"]+)"/.exec(html)?.[1];
    expect(atob(css!)).toBe("b{background:url(data:image/png;base64,AQ==)}");
  });
});
