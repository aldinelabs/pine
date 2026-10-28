/**
 * Decoders for image formats the browser cannot show by itself. Each turns
 * the file into blobs the preview shows through object URLs.
 */

/** Largest TIFF page decoded, in pixels; a page is decoded to RGBA at once. */
export const MAX_TIFF_PAGE_PIXELS = 100_000_000;
/** Pages beyond this are not offered, so a crafted file cannot exhaust memory. */
export const MAX_TIFF_PAGES = 500;

export async function decodeHeic(buffer: ArrayBuffer): Promise<Blob> {
  const { default: heic2any } = await import("heic2any");
  const result = await heic2any({
    blob: new Blob([buffer]),
    toType: "image/png",
  });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) throw new Error("The HEIC file has no image.");
  return blob;
}

export interface TiffDocument {
  pageCount: number;
  /** Decodes one page, 1-based, to a PNG. */
  page: (page: number) => Promise<Blob>;
}

async function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(
        rgba.buffer as ArrayBuffer,
        rgba.byteOffset,
        rgba.byteLength,
      ),
      width,
      height,
    ),
    0,
    0,
  );
  return canvas.convertToBlob({ type: "image/png" });
}

/** Reads a TIFF's page directory; pages decode only when asked for. */
export async function openTiff(buffer: ArrayBuffer): Promise<TiffDocument> {
  const { default: UTIF } = await import("utif");
  const pages = UTIF.decode(buffer).slice(0, MAX_TIFF_PAGES);
  if (!pages.length) throw new Error("The TIFF file has no pages.");
  return {
    pageCount: pages.length,
    async page(number) {
      const ifd = pages[number - 1];
      if (!ifd) throw new Error(`The TIFF file has no page ${number}.`);
      UTIF.decodeImage(buffer, ifd);
      const { width, height } = ifd;
      if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width * height > MAX_TIFF_PAGE_PIXELS
      )
        throw new Error(`TIFF page ${number} is too large to decode.`);
      const rgba = UTIF.toRGBA8(ifd);
      // The decoded strips stay on the directory; drop them once encoded.
      delete ifd.data;
      return encodePng(rgba, width, height);
    },
  };
}
