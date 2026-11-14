import { afterEach, describe, expect, it, vi } from "vitest";
import { exifDate, readExif } from "../exif";
import {
  fetchImageFacts,
  imageProperties,
  readImageFacts,
  readSvgFacts,
  readXmp,
  type ImageFacts,
} from "../image";

type Tag = [tag: number, type: number, value: string | number[]];

const SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

/** A little-endian TIFF structure with IFD0 and an optional EXIF IFD. */
function tiff(main: Tag[], exif: Tag[] = []): Uint8Array {
  const out = new Uint8Array(4096);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  view.setUint32(4, 8, true);
  let data = 2048;
  function directory(at: number, tags: Tag[]): number {
    view.setUint16(at, tags.length, true);
    tags.forEach(([tag, type, value], index) => {
      const entry = at + 2 + index * 12;
      const raw =
        typeof value === "string"
          ? [...new TextEncoder().encode(value), 0]
          : value;
      const count = type === 5 ? raw.length / 2 : raw.length;
      view.setUint16(entry, tag, true);
      view.setUint16(entry + 2, type, true);
      view.setUint32(entry + 4, count, true);
      const size = SIZES[type] * count;
      let target = entry + 8;
      if (size > 4) {
        view.setUint32(entry + 8, data, true);
        target = data;
        data += size + (size % 2);
      }
      raw.forEach((item, position) => {
        if (type === 3) view.setUint16(target + position * 2, item, true);
        else if (type === 4 || type === 5)
          view.setUint32(target + position * 4, item, true);
        else out[target + position] = item;
      });
    });
    return at + 2 + tags.length * 12 + 4;
  }
  const next = directory(8, exif.length ? [...main, [0x8769, 4, [0]]] : main);
  if (exif.length) {
    view.setUint32(8 + 2 + main.length * 12 + 8, next, true);
    directory(next, exif);
  }
  return out;
}

const CAMERA_EXIF = tiff(
  [
    [0x010f, 2, "Canon"],
    [0x0110, 2, "Canon EOS R5"],
    [0x0131, 2, "Lightroom 13.0"],
    [0x013b, 2, "Ada"],
    [0x011a, 5, [300, 1]],
    [0x011b, 5, [300, 1]],
    [0x0128, 3, [2]],
  ],
  [
    [0x9003, 2, "2024:05:01 14:03:22"],
    [0x9011, 2, "+08:00"],
  ],
);

function segment(marker: number, body: Uint8Array): number[] {
  return [
    0xff,
    marker,
    (body.length + 2) >> 8,
    (body.length + 2) & 255,
    ...body,
  ];
}

const text = (value: string) => [...new TextEncoder().encode(value)];

function jpeg(): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segment(
      0xe0,
      new Uint8Array([...text("JFIF\0"), 1, 1, 1, 0, 72, 0, 72, 0, 0]),
    ),
    ...segment(0xe1, new Uint8Array([...text("Exif\0\0"), ...CAMERA_EXIF])),
    ...segment(0xfe, new Uint8Array(text("Shot at dawn"))),
    ...segment(0xc0, new Uint8Array([8, 0, 10, 0, 20, 3, 1, 0x22, 0])),
    0xff,
    0xda,
  ]);
}

function chunk(type: string, body: number[]): number[] {
  const length = body.length;
  return [
    length >>> 24,
    (length >> 16) & 255,
    (length >> 8) & 255,
    length & 255,
    ...text(type),
    ...body,
    0,
    0,
    0,
    0,
  ];
}

const u32 = (value: number) => [
  value >>> 24,
  (value >> 16) & 255,
  (value >> 8) & 255,
  value & 255,
];

function png(): Uint8Array {
  return new Uint8Array([
    0x89,
    ...text("PNG\r\n\x1a\n"),
    ...chunk("IHDR", [...u32(10), ...u32(10), 16, 6, 0, 0, 0]),
    ...chunk("acTL", [...u32(12), ...u32(0)]),
    ...chunk("pHYs", [...u32(5906), ...u32(5906), 1]),
    ...chunk("tEXt", [...text("Title\0Sunrise")]),
    ...chunk("iTXt", [...text("Author\0\0\0\0\0"), ...text("Grace")]),
    ...chunk("tEXt", [...text("Software\0Pine")]),
    ...chunk("IDAT", [0]),
    ...chunk("tEXt", [...text("Comment\0After the pixels")]),
    ...chunk("IEND", []),
  ]);
}

function gif(frames: number, complete = true): Uint8Array {
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0];
  const bytes = [
    ...text("GIF89a"),
    1,
    0,
    1,
    0,
    0xf1, // global table of 4 colors, 8-bit color resolution
    0,
    0,
    ...new Array(12).fill(0),
    0x21,
    0xfe,
    5,
    ...text("Hello"),
    0,
    ...Array.from({ length: frames }, () => frame).flat(),
    0x3b,
  ];
  return new Uint8Array(complete ? bytes : bytes.slice(0, -10));
}

function riff(type: string, body: number[]): number[] {
  const length = body.length;
  return [
    ...text(type),
    length & 255,
    (length >> 8) & 255,
    (length >> 16) & 255,
    length >>> 24,
    ...body,
    ...(length % 2 ? [0] : []),
  ];
}

function webp(): Uint8Array {
  const chunks = [
    ...riff("VP8X", [0x12, 0, 0, 0, 9, 0, 0, 9, 0, 0]),
    ...riff("ANIM", [0, 0, 0, 0, 0, 0]),
    ...riff("ANMF", new Array(16).fill(0)),
    ...riff("ANMF", new Array(16).fill(0)),
    ...riff("ANMF", new Array(16).fill(0)),
  ];
  return new Uint8Array([
    ...text("RIFF"),
    ...[0, 0, 0, 0],
    ...text("WEBP"),
    ...chunks,
  ]);
}

function box(type: string, body: number[]): number[] {
  return [...u32(body.length + 8), ...text(type), ...body];
}

/** A HEIF file whose EXIF item lives after a large media payload. */
function heif(): Uint8Array {
  const exifItem = [...u32(6), ...text("Exif\0\0"), ...CAMERA_EXIF];
  const infe = box("infe", [2, 0, 0, 0, 0, 7, 0, 0, ...text("Exif"), 0]);
  const iinf = box("iinf", [0, 0, 0, 0, 0, 1, ...infe]);
  const ftyp = box("ftyp", [...text("heic"), 0, 0, 0, 0]);
  const padding = new Array(1000).fill(0);
  // iloc v0: 4-byte offsets and lengths, no base offset; one item, one extent.
  const ilocSize = 8 + 4 + 2 + 2 + 2 + 2 + 2 + 8;
  const iinfSize = iinf.length;
  const metaSize = 8 + 4 + iinfSize + ilocSize;
  const mdatStart = ftyp.length + metaSize + 8 + padding.length;
  const iloc = box("iloc", [
    0,
    0,
    0,
    0,
    0x44,
    0,
    0,
    1,
    0,
    7,
    0,
    0,
    0,
    1,
    ...u32(mdatStart),
    ...u32(exifItem.length),
  ]);
  const meta = box("meta", [0, 0, 0, 0, ...iinf, ...iloc]);
  return new Uint8Array([
    ...ftyp,
    ...meta,
    ...box("mdat", [...padding, ...exifItem]),
  ]);
}

describe("readExif", () => {
  it("reads camera, software, date and resolution", () => {
    expect(readExif(CAMERA_EXIF)).toMatchObject({
      make: "Canon",
      model: "Canon EOS R5",
      software: "Lightroom 13.0",
      artist: "Ada",
      taken: "2024-05-01T14:03:22+08:00",
      resolution: [300, 300],
    });
  });

  it("rejects bytes without a TIFF header", () => {
    expect(readExif(new Uint8Array(16))).toBeUndefined();
  });

  it("converts EXIF dates", () => {
    expect(exifDate("2023:12:31 23:59:00")).toBe("2023-12-31T23:59:00");
    expect(exifDate("0000:00:00 00:00:00")).toBeUndefined();
  });
});

describe("readImageFacts", () => {
  it("reads JPEG EXIF, JFIF and the frame header", () => {
    expect(readImageFacts(jpeg())).toEqual({
      camera: "Canon EOS R5",
      author: "Ada",
      taken: "2024-05-01T14:03:22+08:00",
      application: "Lightroom 13.0",
      resolution: [300, 300],
      comment: "Shot at dawn",
      bitDepth: 8,
      colorMode: "RGB",
    });
  });

  it("reads PNG header, text chunks and APNG frames", () => {
    const facts = readImageFacts(png());
    expect(facts).toMatchObject({
      bitDepth: 16,
      colorMode: "RGBA",
      frames: 12,
      title: "Sunrise",
      author: "Grace",
      application: "Pine",
      comment: "After the pixels",
    });
    expect(facts.resolution?.map(Math.round)).toEqual([150, 150]);
  });

  it("counts GIF frames only in a complete file", () => {
    expect(readImageFacts(gif(3))).toEqual({
      colorMode: "Indexed",
      bitDepth: 8,
      comment: "Hello",
      frames: 3,
    });
    expect(readImageFacts(gif(1)).frames).toBeUndefined();
    expect(readImageFacts(gif(3, false)).frames).toBeUndefined();
  });

  it("reads animated WebP frames and alpha", () => {
    expect(readImageFacts(webp())).toMatchObject({
      colorMode: "RGBA",
      bitDepth: 8,
      frames: 3,
    });
  });

  it("reads TIFF tags directly", () => {
    const bytes = tiff([
      [0x0102, 3, [16, 16, 16, 16]],
      [0x0106, 3, [2]],
      [0x0115, 3, [4]],
      [0x0131, 2, "GIMP"],
    ]);
    expect(readImageFacts(bytes)).toMatchObject({
      bitDepth: 16,
      colorMode: "RGBA",
      application: "GIMP",
    });
  });

  it("finds a HEIF file's EXIF item through iinf and iloc", () => {
    expect(readImageFacts(heif())).toMatchObject({
      camera: "Canon EOS R5",
      taken: "2024-05-01T14:03:22+08:00",
    });
  });

  it("keeps what it read before malformed data", () => {
    const bytes = png().slice(0, 60);
    expect(readImageFacts(bytes)).toMatchObject({ colorMode: "RGBA" });
    expect(readImageFacts(new Uint8Array([1, 2, 3]))).toEqual({});
  });
});

describe("readSvgFacts", () => {
  it("reads the title, description and editor", () => {
    expect(
      readSvgFacts(
        '<svg xmlns:inkscape="x" inkscape:version="1.3.2 (091e20e, 2023)"><title>Logo &amp; mark</title><desc>Brand</desc></svg>',
      ),
    ).toEqual({
      title: "Logo & mark",
      comment: "Brand",
      application: "Inkscape 1.3.2",
    });
  });
});

describe("readXmp", () => {
  it("reads attribute and element forms", () => {
    const facts: ImageFacts = {};
    readXmp(
      '<rdf:Description xmp:CreatorTool="Affinity Photo" xmp:CreateDate="2022-03-04T05:06:07"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Harbor</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Lin</rdf:li></rdf:Seq></dc:creator></rdf:Description>',
      facts,
    );
    expect(facts).toEqual({
      title: "Harbor",
      author: "Lin",
      application: "Affinity Photo",
      taken: "2022-03-04T05:06:07",
    });
  });
});

describe("imageProperties", () => {
  it("orders facts and formats resolution", () => {
    expect(
      imageProperties({
        comment: "c",
        camera: "X100V",
        resolution: [72, 144],
        taken: "2024-01-01T00:00:00",
        bitDepth: 0,
      }),
    ).toEqual([
      { key: "camera", value: "X100V" },
      {
        key: "taken",
        type: "date",
        value: new Date("2024-01-01T00:00:00").toISOString(),
      },
      { key: "resolution", value: "72 × 144 dpi" },
      { key: "comment", value: "c" },
    ]);
  });
});

describe("fetchImageFacts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the head by range and the whole file only for animations", async () => {
    const whole = gif(2);
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const range = new Headers(init?.headers).get("range");
      const body = range ? whole.slice(0, 20) : whole;
      return Promise.resolve(
        new Response(new Blob([body as BlobPart]), {
          status: range ? 206 : 200,
          headers: range
            ? { "Content-Range": `bytes 0-19/${whole.byteLength}` }
            : {},
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const facts = await fetchImageFacts("pine-preview://x/a.gif");
    expect(facts.frames).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("range")).toBe(
      "bytes=0-524287",
    );
  });

  it("does not read a still image twice", async () => {
    const bytes = jpeg();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(new Blob([bytes as BlobPart]), {
          status: 206,
          headers: { "Content-Range": `bytes 0-10/${bytes.byteLength * 100}` },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchImageFacts("pine-preview://x/a.jpg")).camera).toBe(
      "Canon EOS R5",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
