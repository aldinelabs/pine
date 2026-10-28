/**
 * Finds something showable in PostScript-based files (EPS, legacy AI) without
 * a PostScript interpreter: a PDF body, the TIFF preview of a DOS EPS, or
 * the bitmap preview of an EPSI. Otherwise the PostScript source is shown.
 */

export type PostScriptContent =
  | { kind: "pdf" }
  | { kind: "tiff"; tiff: ArrayBuffer; source: string }
  | {
      kind: "bitmap";
      width: number;
      height: number;
      rgba: Uint8ClampedArray<ArrayBuffer>;
      source: string;
    }
  | { kind: "source"; source: string };

const latin1 = new TextDecoder("latin1");

/** EPSI previews are rarely large; bigger ones are left as source. */
const MAX_PREVIEW_PIXELS = 16_000_000;

function epsiPreview(source: string) {
  const match =
    /%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+\d+\s*\r?\n([\s\S]*?)%%EndPreview/.exec(
      source,
    );
  if (!match) return undefined;
  const [width, height, depth] = [match[1], match[2], match[3]].map(Number) as [
    number,
    number,
    number,
  ];
  if (
    !width ||
    !height ||
    width * height > MAX_PREVIEW_PIXELS ||
    ![1, 2, 4, 8].includes(depth)
  )
    return undefined;
  const hex = match[4].replace(/[^0-9a-fA-F]/g, "");
  const rowBytes = Math.ceil((width * depth) / 8);
  if (hex.length < rowBytes * height * 2) return undefined;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const max = (1 << depth) - 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const byteIndex = y * rowBytes + (bit >> 3);
      const byte = Number.parseInt(
        hex.slice(byteIndex * 2, byteIndex * 2 + 2),
        16,
      );
      const value = (byte >> (8 - depth - (bit & 7))) & max;
      // EPSI stores 0 as white.
      const level = 255 - Math.round((value / max) * 255);
      const at = (y * width + x) * 4;
      rgba[at] = rgba[at + 1] = rgba[at + 2] = level;
      rgba[at + 3] = 255;
    }
  return { width, height, rgba };
}

export function readPostScript(buffer: ArrayBuffer): PostScriptContent {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (latin1.decode(bytes.subarray(0, 5)) === "%PDF-") return { kind: "pdf" };
  let source: string;
  // A DOS EPS binary header: PostScript, WMF and TIFF sections.
  if (bytes.length >= 30 && view.getUint32(0) === 0xc5d0d3c6) {
    const psOffset = view.getUint32(4, true);
    const psLength = view.getUint32(8, true);
    const tiffOffset = view.getUint32(20, true);
    const tiffLength = view.getUint32(24, true);
    source = latin1.decode(bytes.subarray(psOffset, psOffset + psLength));
    if (tiffLength && tiffOffset + tiffLength <= bytes.length)
      return {
        kind: "tiff",
        tiff: buffer.slice(tiffOffset, tiffOffset + tiffLength),
        source,
      };
  } else source = latin1.decode(bytes);
  const preview = epsiPreview(source);
  if (preview) return { kind: "bitmap", ...preview, source };
  return { kind: "source", source };
}
