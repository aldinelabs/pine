import { describe, expect, it } from "vitest";
import { readFontInfo } from "../fontInfo";

/** A minimal TrueType file with `name`, `maxp` and `OS/2` tables. */
function font(): ArrayBuffer {
  const names: [number, string][] = [
    [1, "Pine Sans"],
    [2, "Bold"],
    [5, "Version 1.20"],
  ];
  const strings = names.map(([, text]) =>
    Array.from(text).flatMap((char) => [0, char.charCodeAt(0)]),
  );
  const nameTable = new Uint8Array(
    6 + names.length * 12 + strings.flat().length,
  );
  const nameView = new DataView(nameTable.buffer);
  nameView.setUint16(2, names.length);
  nameView.setUint16(4, 6 + names.length * 12);
  let stringOffset = 0;
  names.forEach(([id], index) => {
    const at = 6 + index * 12;
    nameView.setUint16(at, 3);
    nameView.setUint16(at + 2, 1);
    nameView.setUint16(at + 4, 0x409);
    nameView.setUint16(at + 6, id);
    nameView.setUint16(at + 8, strings[index].length);
    nameView.setUint16(at + 10, stringOffset);
    nameTable.set(strings[index], 6 + names.length * 12 + stringOffset);
    stringOffset += strings[index].length;
  });
  const maxp = new Uint8Array(6);
  new DataView(maxp.buffer).setUint16(4, 321);
  const os2 = new Uint8Array(96);
  new DataView(os2.buffer).setUint32(46, 1 << 27);
  const tables: [string, Uint8Array][] = [
    ["OS/2", os2],
    ["maxp", maxp],
    ["name", nameTable],
  ];
  const header = 12 + tables.length * 16;
  const size = header + tables.reduce((sum, [, data]) => sum + data.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let offset = header;
  tables.forEach(([tag, data], index) => {
    const at = 12 + index * 16;
    bytes.set(
      Array.from(tag, (char) => char.charCodeAt(0)),
      at,
    );
    view.setUint32(at + 8, offset);
    view.setUint32(at + 12, data.length);
    bytes.set(data, offset);
    offset += data.length;
  });
  return bytes.buffer;
}

describe("readFontInfo", () => {
  it("reads names, glyph count and CJK coverage", async () => {
    await expect(readFontInfo(font())).resolves.toEqual({
      family: "Pine Sans",
      style: "Bold",
      fullName: undefined,
      version: "1.20",
      designer: undefined,
      copyright: undefined,
      glyphCount: 321,
      coversCjk: true,
    });
  });

  it("returns nothing for files it cannot read", async () => {
    await expect(readFontInfo(new ArrayBuffer(64))).resolves.toEqual({
      coversCjk: false,
    });
  });
});
