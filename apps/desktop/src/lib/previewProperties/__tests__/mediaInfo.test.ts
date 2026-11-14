import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bufferByteSource,
  formatBitrate,
  formatSampleRate,
  mediaProperties,
  readMediaInfo,
  urlByteSource,
} from "../mediaInfo";

const text = (value: string) => new TextEncoder().encode(value);
const latin = (value: string) =>
  Uint8Array.from(value, (character) => character.charCodeAt(0));

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrays = parts.map((part) =>
    part instanceof Uint8Array ? part : Uint8Array.from(part),
  );
  const out = new Uint8Array(
    arrays.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u16le = (value: number) => [value & 0xff, value >> 8];
const u32le = (value: number) => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  value >>> 24,
];
const u16 = (value: number) => [value >> 8, value & 0xff];
const u32 = (value: number) => [
  value >>> 24,
  (value >> 16) & 0xff,
  (value >> 8) & 0xff,
  value & 0xff,
];

const read = (bytes: Uint8Array) => readMediaInfo(bufferByteSource(bytes));

describe("MP3", () => {
  function id3v23(frames: [string, string][]): Uint8Array {
    const body = concat(
      ...frames.map(([id, value]) => {
        const data = concat([3], text(value));
        return concat(latin(id), u32(data.length), [0, 0], data);
      }),
    );
    const size = body.length;
    return concat(
      latin("ID3"),
      [3, 0, 0],
      [
        (size >> 21) & 0x7f,
        (size >> 14) & 0x7f,
        (size >> 7) & 0x7f,
        size & 0x7f,
      ],
      body,
    );
  }
  /** MPEG-1 Layer III, 128 kbps, 44.1 kHz, stereo, with a Xing frame count. */
  function frame(frames?: number): Uint8Array {
    const header = [0xff, 0xfb, 0x90, 0x00];
    const side = new Array<number>(32).fill(0);
    const xing = frames ? concat(latin("Xing"), u32(1), u32(frames)) : [];
    return concat(header, side, xing, new Array<number>(64).fill(0));
  }

  it("reads ID3v2 tags and the frame header", async () => {
    const info = await read(
      concat(
        id3v23([
          ["TIT2", "夜曲"],
          ["TPE1", "Artist"],
          ["TALB", "Album"],
        ]),
        frame(),
      ),
    );
    expect(info).toMatchObject({
      title: "夜曲",
      artist: "Artist",
      album: "Album",
      audioCodec: "MP3",
      sampleRate: 44100,
      channels: 2,
      bitrate: 128000,
    });
  });

  it("averages a VBR bitrate from the Xing header and falls back to ID3v1", async () => {
    const audio = frame(100);
    const trailer = concat(
      latin("TAG"),
      latin("Old title".padEnd(30, "\0")),
      latin("Old artist".padEnd(30, "\0")),
      latin("".padEnd(30, "\0")),
      new Array<number>(35).fill(0),
    );
    const info = await read(concat(audio, trailer));
    const duration = (100 * 1152) / 44100;
    expect(info.duration).toBeCloseTo(duration);
    expect(info.bitrate).toBe(
      Math.round(((audio.length + trailer.length) * 8) / duration),
    );
    expect(info).toMatchObject({ title: "Old title", artist: "Old artist" });
    expect(info.album).toBeUndefined();
  });

  it("reads ADTS AAC", async () => {
    // Sample rate index 3 (48 kHz), channel configuration 2.
    const info = await read(
      concat([0xff, 0xf1, 0x4c, 0x80, 0, 0, 0], new Array<number>(16).fill(0)),
    );
    expect(info).toMatchObject({
      audioCodec: "AAC",
      sampleRate: 48000,
      channels: 2,
    });
  });
});

describe("WAV", () => {
  it("reads fmt and LIST INFO after the data chunk", async () => {
    const fmt = concat(
      latin("fmt "),
      u32le(16),
      u16le(1),
      u16le(2),
      u32le(48000),
      u32le(48000 * 2 * 3),
      u16le(6),
      u16le(24),
    );
    const data = concat(latin("data"), u32le(6), new Array<number>(6).fill(0));
    const name = concat(latin("INAM"), u32le(5), latin("Take\0"), [0]);
    const list = concat(
      latin("LIST"),
      u32le(4 + name.length),
      latin("INFO"),
      name,
    );
    const body = concat(latin("WAVE"), fmt, data, list);
    const info = await read(concat(latin("RIFF"), u32le(body.length), body));
    expect(info).toEqual({
      audioCodec: "PCM",
      channels: 2,
      sampleRate: 48000,
      bitrate: 48000 * 2 * 3 * 8,
      bitDepth: 24,
      title: "Take",
    });
  });
});

function vorbisComment(entries: string[]): Uint8Array {
  return concat(
    u32le(6),
    latin("vendor"),
    u32le(entries.length),
    ...entries.map((entry) => concat(u32le(text(entry).length), text(entry))),
  );
}

describe("FLAC", () => {
  it("reads STREAMINFO and Vorbis comments", async () => {
    // 44.1 kHz, 2 channels, 16 bits, 441000 samples (10 s).
    const sampleRate = 44100;
    const streamInfo = concat(
      new Array<number>(10).fill(0),
      [
        sampleRate >> 12,
        (sampleRate >> 4) & 0xff,
        ((sampleRate & 0xf) << 4) | (1 << 1) | 0,
        (15 << 4) | 0,
      ],
      u32(441000),
      new Array<number>(16).fill(0),
    );
    const comment = vorbisComment(["title=Etude", "ARTIST=Pianist"]);
    const block = (type: number, body: Uint8Array) =>
      concat(
        [type],
        [body.length >> 16, (body.length >> 8) & 0xff, body.length & 0xff],
        body,
      );
    const file = concat(
      latin("fLaC"),
      block(0, streamInfo),
      block(0x84, comment),
      new Array<number>(100).fill(0),
    );
    const info = await read(file);
    expect(info).toMatchObject({
      audioCodec: "FLAC",
      sampleRate: 44100,
      channels: 2,
      bitDepth: 16,
      duration: 10,
      title: "Etude",
      artist: "Pianist",
      bitrate: Math.round((100 * 8) / 10),
    });
  });
});

describe("Ogg", () => {
  function page(serial: number, packet: Uint8Array): Uint8Array {
    const lacing: number[] = [];
    let left = packet.length;
    while (left >= 255) {
      lacing.push(255);
      left -= 255;
    }
    lacing.push(left);
    return concat(
      latin("OggS"),
      [0, 2],
      new Array<number>(8).fill(0),
      u32le(serial),
      u32le(0),
      u32le(0),
      [lacing.length],
      lacing,
      packet,
    );
  }

  it("reads Opus headers and tags", async () => {
    const head = concat(
      latin("OpusHead"),
      [1, 2],
      u16le(312),
      u32le(44100),
      [0, 0, 0],
    );
    const tags = concat(
      latin("OpusTags"),
      vorbisComment(["TITLE=Voice", "ALBUM=Memos"]),
    );
    const info = await read(concat(page(7, head), page(7, tags)));
    expect(info).toEqual({
      audioCodec: "Opus",
      channels: 2,
      sampleRate: 44100,
      title: "Voice",
      album: "Memos",
    });
  });

  it("reads Vorbis spanning several segments", async () => {
    const id = concat(
      [1],
      latin("vorbis"),
      u32le(0),
      [6],
      u32le(48000),
      u32le(0),
      u32le(192000),
      u32le(0),
      [0, 1],
    );
    const comment = concat(
      [3],
      latin("vorbis"),
      vorbisComment(["TITLE=" + "x".repeat(300)]),
    );
    const info = await read(concat(page(1, id), page(1, comment)));
    expect(info).toMatchObject({
      audioCodec: "Vorbis",
      channels: 6,
      sampleRate: 48000,
      bitrate: 192000,
      title: "x".repeat(300),
    });
  });
});

describe("MP4", () => {
  const box = (type: string, ...children: (Uint8Array | number[])[]) => {
    const body = concat(...children);
    return concat(u32(8 + body.length), latin(type), body);
  };

  function movie(): Uint8Array {
    const mvhd = box(
      "mvhd",
      [0, 0, 0, 0],
      u32(0),
      u32(0),
      u32(1000),
      u32(10_000),
      new Array<number>(80).fill(0),
    );
    const mdhd = box(
      "mdhd",
      [0, 0, 0, 0],
      u32(0),
      u32(0),
      u32(30_000),
      u32(300_300),
      new Array<number>(4).fill(0),
    );
    const hdlr = (kind: string) =>
      box(
        "hdlr",
        [0, 0, 0, 0],
        u32(0),
        latin(kind),
        new Array<number>(13).fill(0),
      );
    const stsd = (entry: Uint8Array) =>
      box("stsd", [0, 0, 0, 0], u32(1), entry);
    const video = box(
      "trak",
      box(
        "mdia",
        mdhd,
        hdlr("vide"),
        box(
          "minf",
          box(
            "stbl",
            stsd(box("avc1", new Array<number>(78).fill(0))),
            // 300 samples of 1001 ticks at 30000 → 29.97 fps.
            box("stts", [0, 0, 0, 0], u32(1), u32(300), u32(1001)),
          ),
        ),
      ),
    );
    const audioEntry = box(
      "mp4a",
      new Array<number>(6).fill(0),
      u16(1),
      new Array<number>(8).fill(0),
      u16(2),
      u16(16),
      u32(0),
      u32(48000 * 65536),
    );
    const audio = box(
      "trak",
      box("mdia", hdlr("soun"), box("minf", box("stbl", stsd(audioEntry)))),
    );
    const item = (type: string, value: string) =>
      box(type, box("data", u32(1), u32(0), text(value)));
    const meta = box(
      "meta",
      [0, 0, 0, 0],
      hdlr("mdir"),
      box("ilst", item("©nam", "Trip"), item("©ART", "Me")),
    );
    return box("moov", mvhd, video, audio, box("udta", meta));
  }

  it("finds moov after mdat and reads tracks and tags", async () => {
    const file = concat(
      box("ftyp", latin("isom"), u32(0)),
      box("mdat", new Array<number>(70 * 1024).fill(0)),
      movie(),
    );
    const info = await read(file);
    expect(info).toMatchObject({
      duration: 10,
      videoCodec: "H.264",
      audioCodec: "AAC",
      channels: 2,
      sampleRate: 48000,
      title: "Trip",
      artist: "Me",
    });
    expect(info.frameRate).toBeCloseTo(29.97, 2);
  });
});

describe("Matroska", () => {
  const el = (id: number[], ...children: (Uint8Array | number[])[]) => {
    // Eight-byte sizes keep the builder simple: a 0x01 marker, then 7 bytes.
    const body = concat(...children);
    const size = body.length;
    return concat(
      id,
      [
        0x01,
        0,
        0,
        0,
        (size >>> 24) & 0xff,
        (size >> 16) & 0xff,
        (size >> 8) & 0xff,
        size & 0xff,
      ],
      body,
    );
  };
  const float64 = (value: number) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value);
    return bytes;
  };

  it("reads info, tracks and tags", async () => {
    const header = el(
      [0x1a, 0x45, 0xdf, 0xa3],
      el([0x42, 0x82], latin("webm")),
    );
    const info = el(
      [0x15, 0x49, 0xa9, 0x66],
      el([0x2a, 0xd7, 0xb1], u32(1_000_000)),
      el([0x44, 0x89], float64(5000)),
      el([0x7b, 0xa9], text("Clip")),
    );
    const tracks = el(
      [0x16, 0x54, 0xae, 0x6b],
      el(
        [0xae],
        el([0x83], [1]),
        el([0x86], latin("V_VP9")),
        el([0x23, 0xe3, 0x83], u32(40_000_000)),
      ),
      el(
        [0xae],
        el([0x83], [2]),
        el([0x86], latin("A_OPUS")),
        el([0xe1], el([0xb5], float64(48000)), el([0x9f], [6])),
      ),
    );
    const tags = el(
      [0x12, 0x54, 0xc3, 0x67],
      el(
        [0x73, 0x73],
        el(
          [0x67, 0xc8],
          el([0x45, 0xa3], latin("ARTIST")),
          el([0x44, 0x87], text("Crew")),
        ),
      ),
    );
    // Segment of unknown size, as live recorders write it.
    const segment = concat(
      [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
      info,
      tracks,
      tags,
    );
    expect(await read(concat(header, segment))).toEqual({
      title: "Clip",
      duration: 5,
      videoCodec: "VP9",
      frameRate: 25,
      audioCodec: "Opus",
      sampleRate: 48000,
      channels: 6,
      artist: "Crew",
    });
  });
});

describe("mediaProperties", () => {
  it("lists audio tags and stream facts, most useful first", () => {
    expect(
      mediaProperties(
        {
          title: "Song",
          artist: "Band",
          audioCodec: "FLAC",
          sampleRate: 44100,
          channels: 2,
          bitDepth: 16,
          bitrate: 900_000,
        },
        "audio",
      ),
    ).toEqual([
      { key: "title", value: "Song" },
      { key: "artist", value: "Band" },
      { key: "codec", value: "FLAC" },
      { key: "bitrate", value: "900 kbps" },
      { key: "sampleRate", value: "44.1 kHz" },
      { key: "channels", type: "number", value: 2 },
      { key: "bitDepth", type: "number", value: 16 },
    ]);
  });

  it("joins video and audio codecs and averages the bitrate over the file", () => {
    expect(
      mediaProperties(
        {
          videoCodec: "H.264",
          audioCodec: "AAC",
          frameRate: 30000 / 1001,
          channels: 6,
          bitDepth: 16,
        },
        "video",
        { duration: 10, size: 25_000_000 },
      ),
    ).toEqual([
      { key: "codec", value: "H.264 / AAC" },
      { key: "frameRate", value: "29.97 fps" },
      { key: "bitrate", value: "20 Mbps" },
      { key: "channels", value: "5.1" },
    ]);
  });

  it("leaves out what is unknown", () => {
    expect(mediaProperties({}, "audio", { duration: Infinity })).toEqual([]);
  });

  it("formats rates", () => {
    expect(formatSampleRate(48000)).toBe("48 kHz");
    expect(formatSampleRate(22050)).toBe("22.05 kHz");
    expect(formatSampleRate(800)).toBe("800 Hz");
    expect(formatBitrate(128_000)).toBe("128 kbps");
    expect(formatBitrate(12_340_000)).toBe("12.3 Mbps");
  });
});

describe("urlByteSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests byte ranges and learns the size", async () => {
    const fetch = vi.fn(
      () =>
        new Response(new Uint8Array([1, 2]), {
          status: 206,
          headers: { "Content-Range": "bytes 10-11/500" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const source = urlByteSource("pine-preview://file");
    expect(await source.read(10, 2)).toEqual(new Uint8Array([1, 2]));
    expect(source.size).toBe(500);
    expect(fetch).toHaveBeenCalledWith("pine-preview://file", {
      signal: undefined,
      headers: { Range: "bytes=10-11" },
    });
  });

  it("refuses a full response instead of reading the whole file", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("whole file")));
    await expect(urlByteSource("x").read(0, 4)).rejects.toThrow();
  });
});
