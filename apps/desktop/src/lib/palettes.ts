/** Readers for Adobe swatch files: Swatch Exchange (.ase) and Photoshop (.aco). */

export interface Swatch {
  name?: string;
  /** A CSS color the swatch shows as. */
  css: string;
  /** `#rrggbb` for copying, when the color converts to sRGB. */
  hex: string;
  /** The color as authored, such as `CMYK 0 50 100 0`. */
  source: string;
}

export interface SwatchGroup {
  name?: string;
  swatches: Swatch[];
}

const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

function hexOf(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(r: number, g: number, b: number, source: string): Swatch {
  const hex = hexOf(r, g, b);
  return { css: hex, hex, source };
}

function cmyk(c: number, m: number, y: number, k: number): Swatch {
  const r = 255 * (1 - c) * (1 - k);
  const g = 255 * (1 - m) * (1 - k);
  const b = 255 * (1 - y) * (1 - k);
  const percent = (v: number) => Math.round(v * 100);
  return rgb(r, g, b, `CMYK ${[c, m, y, k].map(percent).join(" ")}`);
}

/** CIE L*a*b* (D50) to sRGB, for the copyable hex value. */
function lab(l: number, a: number, bValue: number): Swatch {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bValue / 200;
  const inverse = (t: number) =>
    t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
  const [x, y, z] = [inverse(fx) * 0.9642, inverse(fy), inverse(fz) * 0.8251];
  // Bradford-adapted D50 XYZ to linear sRGB.
  const linear = [
    3.1338561 * x - 1.6168667 * y - 0.4906146 * z,
    -0.9787684 * x + 1.9161415 * y + 0.033454 * z,
    0.0719453 * x - 0.2289914 * y + 1.4052427 * z,
  ].map(
    (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055),
  );
  const hex = hexOf(linear[0], linear[1], linear[2]);
  const rounded = [l, a, bValue].map((v) => Math.round(v * 10) / 10);
  return {
    css: `lab(${rounded[0]}% ${rounded[1]} ${rounded[2]})`,
    hex,
    source: `Lab ${rounded.join(" ")}`,
  };
}

function gray(value: number): Swatch {
  const level = 255 * value;
  return {
    ...rgb(level, level, level, ""),
    source: `Gray ${Math.round(value * 100)}%`,
  };
}

function hsb(h: number, s: number, v: number): Swatch {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgb(
    255 * f(5),
    255 * f(3),
    255 * f(1),
    `HSB ${Math.round(h)} ${Math.round(s * 100)} ${Math.round(v * 100)}`,
  );
}

export function readAse(buffer: ArrayBuffer): SwatchGroup[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || view.getUint32(0) !== 0x41534546)
    throw new Error("Not an Adobe Swatch Exchange file.");
  const count = view.getUint32(8);
  const groups: SwatchGroup[] = [{ swatches: [] }];
  let current = groups[0];
  let offset = 12;
  const name = (at: number): [string, number] => {
    const length = view.getUint16(at);
    const chars: number[] = [];
    for (let index = 0; index < length; index++)
      chars.push(view.getUint16(at + 2 + index * 2));
    return [
      String.fromCharCode(...chars).replace(/\0+$/, ""),
      at + 2 + length * 2,
    ];
  };
  for (
    let block = 0;
    block < count && offset + 6 <= buffer.byteLength;
    block++
  ) {
    const type = view.getUint16(offset);
    const length = view.getUint32(offset + 2);
    const body = offset + 6;
    offset = body + length;
    if (offset > buffer.byteLength)
      throw new Error("The swatch file is truncated.");
    if (type === 0xc001) {
      current = { name: length ? name(body)[0] : undefined, swatches: [] };
      groups.push(current);
    } else if (type === 0xc002) {
      current = groups[0]!;
    } else if (type === 0x0001) {
      const [label, at] = name(body);
      const model = String.fromCharCode(
        ...new Uint8Array(buffer, at, 4),
      ).trim();
      const float = (index: number) => view.getFloat32(at + 4 + index * 4);
      const swatch =
        model === "RGB"
          ? rgb(float(0) * 255, float(1) * 255, float(2) * 255, "")
          : model === "CMYK"
            ? cmyk(float(0), float(1), float(2), float(3))
            : model === "LAB"
              ? lab(float(0) * 100, float(1), float(2))
              : gray(float(0));
      if (!swatch.source) swatch.source = `RGB ${swatch.hex}`;
      current.swatches.push({ ...swatch, name: label || undefined });
    }
  }
  return groups.filter((group) => group.swatches.length);
}

export function readAco(buffer: ArrayBuffer): SwatchGroup[] {
  const view = new DataView(buffer);
  const section = (offset: number, version: number) => {
    const count = view.getUint16(offset + 2);
    const swatches: Swatch[] = [];
    let at = offset + 4;
    for (let index = 0; index < count; index++) {
      if (at + 10 > buffer.byteLength)
        throw new Error("The swatch file is truncated.");
      const space = view.getUint16(at);
      const [w, x, y, z] = [2, 4, 6, 8].map((delta) =>
        view.getUint16(at + delta),
      ) as [number, number, number, number];
      // Lab stores a and b as signed hundredths.
      const labA = view.getInt16(at + 4) / 100;
      const labB = view.getInt16(at + 6) / 100;
      at += 10;
      let name: string | undefined;
      if (version === 2) {
        const length = view.getUint32(at);
        const chars: number[] = [];
        for (let char = 0; char < length; char++)
          chars.push(view.getUint16(at + 4 + char * 2));
        name = String.fromCharCode(...chars).replace(/\0+$/, "") || undefined;
        at += 4 + length * 2;
      }
      const swatch =
        space === 0
          ? rgb(w / 257, x / 257, y / 257, "")
          : space === 1
            ? hsb((w / 65535) * 360, x / 65535, y / 65535)
            : space === 2
              ? cmyk(1 - w / 65535, 1 - x / 65535, 1 - y / 65535, 1 - z / 65535)
              : space === 7
                ? lab(w / 100, labA, labB)
                : space === 8
                  ? gray(1 - w / 10000)
                  : undefined;
      if (!swatch) continue;
      if (!swatch.source) swatch.source = `RGB ${swatch.hex}`;
      swatches.push({ ...swatch, name });
    }
    return { swatches, end: at };
  };
  if (buffer.byteLength < 4 || view.getUint16(0) !== 1)
    throw new Error("Not a Photoshop swatch file.");
  const first = section(0, 1);
  // Version 2, with names, usually follows version 1.
  if (first.end + 4 <= buffer.byteLength && view.getUint16(first.end) === 2)
    return [{ swatches: section(first.end, 2).swatches }];
  return [{ swatches: first.swatches }];
}
