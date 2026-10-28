import { describe, expect, it } from "vitest";
import { readPostScript } from "../postscript";

const encode = (text: string) => new TextEncoder().encode(text).buffer;

describe("readPostScript", () => {
  it("recognizes PDF-compatible files", () => {
    expect(readPostScript(encode("%PDF-1.6\n..."))).toEqual({ kind: "pdf" });
  });

  it("decodes an EPSI bitmap preview", () => {
    const source =
      "%!PS-Adobe-3.0 EPSF-3.0\n%%BeginPreview: 2 2 1 2\n% 80\n% 40\n%%EndPreview\n";
    const content = readPostScript(encode(source));
    expect(content.kind).toBe("bitmap");
    if (content.kind !== "bitmap") return;
    expect([content.width, content.height]).toEqual([2, 2]);
    // Set bits are black: row one starts black, row two ends black.
    expect(
      Array.from(content.rgba.filter((_, index) => index % 4 === 0)),
    ).toEqual([0, 255, 255, 0]);
  });

  it("finds the TIFF section of a DOS EPS", () => {
    const tiff = [0x49, 0x49, 0x2a, 0x00];
    const ps = Array.from("%!PS", (char) => char.charCodeAt(0));
    const bytes = new Uint8Array(30 + ps.length + tiff.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0xc5d0d3c6);
    view.setUint32(4, 30, true);
    view.setUint32(8, ps.length, true);
    view.setUint32(20, 30 + ps.length, true);
    view.setUint32(24, tiff.length, true);
    bytes.set(ps, 30);
    bytes.set(tiff, 30 + ps.length);
    const content = readPostScript(bytes.buffer);
    expect(content.kind).toBe("tiff");
    if (content.kind !== "tiff") return;
    expect(content.source).toBe("%!PS");
    expect(new Uint8Array(content.tiff)).toEqual(new Uint8Array(tiff));
  });

  it("falls back to the source", () => {
    expect(readPostScript(encode("%!PS\nshowpage"))).toEqual({
      kind: "source",
      source: "%!PS\nshowpage",
    });
  });
});
