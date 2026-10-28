import { describe, expect, it } from "vitest";
import { readAco, readAse } from "../palettes";

class Writer {
  bytes: number[] = [];
  u16(value: number) {
    this.bytes.push(value >> 8, value & 0xff);
    return this;
  }
  u32(value: number) {
    return this.u16(value >>> 16).u16(value & 0xffff);
  }
  f32(value: number) {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value);
    this.bytes.push(...new Uint8Array(view.buffer));
    return this;
  }
  ascii(text: string) {
    this.bytes.push(...Array.from(text, (char) => char.charCodeAt(0)));
    return this;
  }
  utf16(text: string, lengthBytes: 2 | 4) {
    const chars = [...text, "\0"];
    if (lengthBytes === 2) this.u16(chars.length);
    else this.u32(chars.length);
    for (const char of chars) this.u16(char.charCodeAt(0));
    return this;
  }
  get buffer() {
    return new Uint8Array(this.bytes).buffer;
  }
}

function aseColor(name: string, model: string, values: number[]) {
  const body = new Writer().utf16(name, 2).ascii(model);
  for (const value of values) body.f32(value);
  body.u16(2);
  return new Writer().u16(1).u32(body.bytes.length).bytes.concat(body.bytes);
}

describe("readAse", () => {
  it("reads grouped RGB, CMYK and gray swatches", () => {
    const group = new Writer().utf16("Brand", 2);
    const writer = new Writer().ascii("ASEF").u16(1).u16(0).u32(5);
    writer.bytes.push(...aseColor("Sky", "RGB ", [0.2, 0.4, 1]));
    writer.u16(0xc001).u32(group.bytes.length);
    writer.bytes.push(...group.bytes);
    writer.bytes.push(...aseColor("Ink", "CMYK", [0, 0, 0, 1]));
    writer.bytes.push(...aseColor("Mid", "Gray", [0.5]));
    writer.u16(0xc002).u32(0);
    const groups = readAse(writer.buffer);
    expect(groups).toHaveLength(2);
    expect(groups[0].swatches[0]).toMatchObject({
      name: "Sky",
      hex: "#3366ff",
    });
    expect(groups[1].name).toBe("Brand");
    expect(groups[1].swatches.map((swatch) => swatch.hex)).toEqual([
      "#000000",
      "#808080",
    ]);
    expect(groups[1].swatches[0].source).toBe("CMYK 0 0 0 100");
  });

  it("rejects other files", () => {
    expect(() =>
      readAse(new Writer().ascii("NOPE0000000000").buffer),
    ).toThrow();
  });
});

describe("readAco", () => {
  it("prefers the named version 2 section", () => {
    const writer = new Writer()
      .u16(1)
      .u16(1)
      .u16(0)
      .u16(0xffff)
      .u16(0)
      .u16(0)
      .u16(0);
    writer.u16(2).u16(1).u16(0).u16(0).u16(0xffff).u16(0).u16(0);
    writer.utf16("Green", 4);
    const [group] = readAco(writer.buffer);
    expect(group.swatches).toEqual([
      expect.objectContaining({ name: "Green", hex: "#00ff00" }),
    ]);
  });

  it("reads version 1 alone and Lab colors", () => {
    const writer = new Writer()
      .u16(1)
      .u16(1)
      .u16(7)
      .u16(5000)
      .u16(0)
      .u16(0)
      .u16(0);
    const [group] = readAco(writer.buffer);
    expect(group.swatches[0].css).toBe("lab(50% 0 0)");
    expect(group.swatches[0].hex).toBe("#777777");
  });
});
