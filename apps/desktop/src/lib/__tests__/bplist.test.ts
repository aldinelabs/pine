import { describe, expect, it } from "vitest";
import { parseBplist, readWebArchive } from "../bplist";

/** Encodes objects (already given as marker bytes) into a bplist00 file. */
function bplist(objects: number[][], top = 0): ArrayBuffer {
  const header = Array.from("bplist00", (char) => char.charCodeAt(0));
  const body: number[] = [];
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(header.length + body.length);
    body.push(...object);
  }
  const table = header.length + body.length;
  const trailer = new Uint8Array(32);
  const view = new DataView(trailer.buffer);
  trailer[6] = 1; // offset size
  trailer[7] = 1; // reference size
  view.setBigUint64(8, BigInt(objects.length));
  view.setBigUint64(16, BigInt(top));
  view.setBigUint64(24, BigInt(table));
  return new Uint8Array([...header, ...body, ...offsets, ...trailer]).buffer;
}

/** A marker byte, with the length after it once it does not fit in 4 bits. */
const sized = (type: number, length: number) =>
  length < 15 ? [type | length] : [type | 0x0f, 0x10, length];
const ascii = (text: string) => [
  ...sized(0x50, text.length),
  ...Array.from(text, (char) => char.charCodeAt(0)),
];
const data = (bytes: number[]) => [...sized(0x40, bytes.length), ...bytes];

describe("parseBplist", () => {
  it("reads dictionaries, arrays and scalars", () => {
    const value = parseBplist(
      bplist([
        [0xd2, 1, 2, 3, 4], // { a: [true, 7], b: "hi" }
        ascii("a"),
        ascii("b"),
        [0xa2, 5, 6],
        ascii("hi"),
        [0x09],
        [0x10, 7],
      ]),
    );
    expect(value).toEqual({ a: [true, 7], b: "hi" });
  });

  it("rejects other files and bad references", () => {
    expect(() => parseBplist(new ArrayBuffer(64))).toThrow();
    expect(() => parseBplist(bplist([[0xa1, 9]]))).toThrow(/reference/);
  });
});

describe("readWebArchive", () => {
  it("reads the main resource and its subresources", () => {
    const html = Array.from("<p>hi</p>", (char) => char.charCodeAt(0));
    const archive = readWebArchive(
      bplist([
        [0xd2, 1, 2, 3, 4],
        ascii("WebMainResource"),
        ascii("WebSubresources"),
        [0xd2, 5, 6, 7, 8],
        [0xa1, 9],
        ascii("WebResourceData"),
        ascii("WebResourceMIMEType"),
        data(html),
        ascii("text/html"),
        [0xd2, 5, 10, 11, 12],
        ascii("WebResourceURL"),
        data([1, 2]),
        ascii("https://x/a.png"),
      ]),
    );
    expect(new TextDecoder().decode(archive.main.data)).toBe("<p>hi</p>");
    expect(archive.main.mimeType).toBe("text/html");
    expect(archive.subresources).toEqual([
      {
        data: new Uint8Array([1, 2]),
        url: "https://x/a.png",
        mimeType: undefined,
        encoding: undefined,
      },
    ]);
  });
});
