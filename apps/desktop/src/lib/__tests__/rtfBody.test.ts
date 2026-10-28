import { describe, expect, it } from "vitest";
import { decompressRtf, rtfToContent } from "../rtfBody";

const encode = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("decompressRtf", () => {
  it("decompresses the MS-OXRTFCP example", () => {
    const compressed = new Uint8Array([
      0x2d, 0x00, 0x00, 0x00, 0x2b, 0x00, 0x00, 0x00, 0x4c, 0x5a, 0x46, 0x75,
      0xf1, 0xc5, 0xc7, 0xa7, 0x03, 0x00, 0x0a, 0x00, 0x72, 0x63, 0x70, 0x67,
      0x31, 0x32, 0x35, 0x42, 0x32, 0x0a, 0xf3, 0x20, 0x68, 0x65, 0x6c, 0x09,
      0x00, 0x20, 0x62, 0x77, 0x05, 0xb0, 0x6c, 0x64, 0x7d, 0x0a, 0x80, 0x0f,
      0xa0,
    ]);
    expect(new TextDecoder().decode(decompressRtf(compressed))).toBe(
      "{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n",
    );
  });

  it("returns stored bodies as they are", () => {
    const body = encode("{\\rtf1 hi}");
    const header = new Uint8Array(16);
    const view = new DataView(header.buffer);
    view.setUint32(4, body.length, true);
    view.setUint32(8, 0x414c454d, true);
    expect(decompressRtf(new Uint8Array([...header, ...body]))).toEqual(body);
  });

  it("rejects unknown compression", () => {
    expect(() => decompressRtf(new Uint8Array(16))).toThrow();
  });
});

describe("rtfToContent", () => {
  it("recovers encapsulated HTML", () => {
    const rtf = encode(
      "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 {\\fonttbl{\\f0 Arial;}}" +
        "{\\*\\htmltag64 <p>}\\htmlrtf {\\htmlrtf0 Caf\\'e9 \\u8212? ok" +
        "\\htmlrtf {\\b bold rtf only}\\htmlrtf0 }{\\*\\htmltag72 </p>}}",
    );
    expect(rtfToContent(rtf).html).toBe("<p>Café — ok</p>");
  });

  it("reads plain RTF as text", () => {
    const rtf = encode(
      "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator x;}Hello\\par World\\tab!}",
    );
    expect(rtfToContent(rtf)).toEqual({ text: "Hello\nWorld\t!" });
  });
});
