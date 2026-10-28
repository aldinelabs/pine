import { describe, expect, it } from "vitest";
import { columnName, parseDelimited, readDbf } from "../tabularData";

describe("parseDelimited", () => {
  it("reads quoted fields with delimiters, quotes and line breaks", () => {
    const table = parseDelimited(
      '﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\nBo,\n',
      ",",
    );
    expect(table.columns).toEqual(["name", "note"]);
    expect(table.rows).toEqual([
      ["Smith, J", 'said "hi"\nthen left'],
      ["Bo", ""],
    ]);
    expect(table.truncated).toBe(false);
  });

  it("names missing header cells and reads tabs", () => {
    const table = parseDelimited("a\t\n1\t2\t3", "\t");
    expect(table.columns).toEqual(["a", "B", "C"]);
    expect(table.rows).toEqual([["1", "2", "3"]]);
  });

  it("stops after the row limit", () => {
    const table = parseDelimited("h\n1\n2\n3\n", ",", 2);
    expect(table.rows).toEqual([["1"], ["2"]]);
    expect(table.truncated).toBe(true);
  });

  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual([
      "A",
      "Z",
      "AA",
      "ZZ",
      "AAA",
    ]);
  });
});

function dbf(languageDriver: number, records: string[][]): ArrayBuffer {
  const fields = [
    { name: "NAME", type: "C", length: 8 },
    { name: "AGE", type: "N", length: 3 },
    { name: "OK", type: "L", length: 1 },
  ];
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const bytes = new Uint8Array(
    headerLength + records.length * recordLength + 1,
  );
  const view = new DataView(bytes.buffer);
  bytes[0] = 3;
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  bytes[29] = languageDriver;
  fields.forEach((field, index) => {
    const at = 32 + index * 32;
    bytes.set(new TextEncoder().encode(field.name), at);
    bytes[at + 11] = field.type.charCodeAt(0);
    bytes[at + 16] = field.length;
  });
  bytes[headerLength - 1] = 0x0d;
  records.forEach((record, row) => {
    let at = headerLength + row * recordLength;
    bytes[at++] = 0x20;
    record.forEach((value, index) => {
      const encoded = Uint8Array.from(value, (char) => char.charCodeAt(0));
      bytes.fill(0x20, at, at + fields[index].length);
      bytes.set(encoded, at);
      at += fields[index].length;
    });
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes.buffer;
}

describe("readDbf", () => {
  it("reads fields and typed records on demand", () => {
    const table = readDbf(
      dbf(0x03, [
        ["Alice", " 30", "T"],
        ["Bob", "   ", "?"],
      ]),
    );
    expect(table.fields.map((field) => field.name)).toEqual([
      "NAME",
      "AGE",
      "OK",
    ]);
    expect(table.rowCount).toBe(2);
    expect(table.rows(0, 2)).toEqual([
      ["Alice", 30, true],
      ["Bob", null, null],
    ]);
    expect(table.rows(1, 10)).toHaveLength(1);
  });

  it("decodes text in the header's code page", () => {
    // "北京" in GBK.
    const table = readDbf(
      dbf(0x4d, [[String.fromCharCode(0xb1, 0xb1, 0xbe, 0xa9), "1", "F"]]),
    );
    expect(table.rows(0, 1)[0]).toEqual(["北京", 1, false]);
  });

  it("rejects a truncated header", () => {
    expect(() => readDbf(new ArrayBuffer(8))).toThrow();
  });
});
