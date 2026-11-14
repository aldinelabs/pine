import type { PreviewProperty } from "@/components/project/file-preview/previewRenderer";

/**
 * Reads what audio and video containers record in their headers — tags,
 * codecs, sample rate, channels, frame rate, bitrate — through byte ranges,
 * never the whole file.
 */

/** Random access to a file's bytes. */
export interface ByteSource {
  /** Bytes from `offset`; may return fewer at the end of the file. */
  read(offset: number, length: number): Promise<Uint8Array>;
  /** Total size, once known. */
  size?: number;
}

export interface MediaInfo {
  title?: string;
  artist?: string;
  album?: string;
  videoCodec?: string;
  audioCodec?: string;
  /** Hz. */
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  frameRate?: number;
  /** Bits per second. */
  bitrate?: number;
  /** Seconds, when the header records it. */
  duration?: number;
}

/** The most a single header read takes, so damaged sizes cannot ask for gigabytes. */
const MAX_READ = 8 * 1024 * 1024;
const HEAD = 64 * 1024;

/** Reads byte ranges of a preview URL. */
export function urlByteSource(url: string, signal?: AbortSignal): ByteSource {
  const source: ByteSource = {
    async read(offset, length) {
      if (length <= 0) return new Uint8Array();
      const response = await fetch(url, {
        signal,
        headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      });
      if (response.status === 416) return new Uint8Array();
      if (!response.ok)
        throw new Error(`Range read failed (${response.status}).`);
      const total = /\/(\d+)$/.exec(
        response.headers.get("content-range") ?? "",
      );
      if (total) source.size = Number(total[1]);
      // A server that ignores ranges sends everything; keep only what was asked.
      if (response.status === 200) {
        response.body?.cancel().catch(() => undefined);
        throw new Error("Byte ranges are not supported.");
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
  return source;
}

/** A source over bytes in memory (tests, small files). */
export function bufferByteSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: (offset, length) =>
      Promise.resolve(
        bytes.subarray(offset, Math.min(bytes.length, offset + length)),
      ),
  };
}

// ---------------------------------------------------------------------------
// Byte helpers

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (
    let index = start;
    index < start + length && index < bytes.length;
    index++
  )
    text += String.fromCharCode(bytes[index]);
  return text;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decode(bytes: Uint8Array, encoding = "utf-8"): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return "";
  }
}

function clean(text: string | undefined): string | undefined {
  const value = text?.replace(/\u0000+/gu, " ").trim();
  return value || undefined;
}

function startsWith(bytes: Uint8Array, text: string, at = 0): boolean {
  return ascii(bytes, at, text.length) === text;
}

/** Keeps the first non-empty value of each field. */
function fill(target: MediaInfo, source: MediaInfo): void {
  for (const [key, value] of Object.entries(source) as [
    keyof MediaInfo,
    MediaInfo[keyof MediaInfo],
  ][])
    if (target[key] === undefined && value !== undefined && value !== "")
      (target as Record<string, unknown>)[key] = value;
}

// ---------------------------------------------------------------------------
// Vorbis comments (FLAC, Ogg Vorbis/Opus/Theora)

function vorbisComments(bytes: Uint8Array, start: number): MediaInfo {
  const data = view(bytes);
  let offset = start;
  if (offset + 4 > bytes.length) return {};
  offset += 4 + data.getUint32(offset, true);
  if (offset + 4 > bytes.length) return {};
  const count = data.getUint32(offset, true);
  offset += 4;
  const tags: Record<string, string> = {};
  for (let index = 0; index < count && offset + 4 <= bytes.length; index++) {
    const length = data.getUint32(offset, true);
    offset += 4;
    const entry = decode(bytes.subarray(offset, offset + length));
    offset += length;
    const split = entry.indexOf("=");
    if (split > 0) {
      const key = entry.slice(0, split).toUpperCase();
      tags[key] ??= entry.slice(split + 1);
    }
  }
  return {
    title: clean(tags.TITLE),
    artist: clean(tags.ARTIST ?? tags.ALBUMARTIST),
    album: clean(tags.ALBUM),
  };
}

// ---------------------------------------------------------------------------
// MP3 / ID3 / ADTS

const ID3_FRAMES: Record<string, keyof MediaInfo> = {
  TIT2: "title",
  TPE1: "artist",
  TPE2: "artist",
  TALB: "album",
  TT2: "title",
  TP1: "artist",
  TP2: "artist",
  TAL: "album",
};

function id3Text(bytes: Uint8Array): string | undefined {
  const encoding = bytes[0];
  const body = bytes.subarray(1);
  const text =
    encoding === 1
      ? decode(body, "utf-16")
      : encoding === 2
        ? decode(body, "utf-16be")
        : encoding === 3
          ? decode(body)
          : decode(body, "latin1");
  // Multiple values are separated by NUL; the first is the main one.
  return clean(text.split("\u0000").find((part) => part.trim()));
}

function synchsafe(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] & 0x7f) << 21) |
    ((bytes[at + 1] & 0x7f) << 14) |
    ((bytes[at + 2] & 0x7f) << 7) |
    (bytes[at + 3] & 0x7f)
  );
}

/** Parses an ID3v2 tag (header included). */
export function parseId3v2(tag: Uint8Array): MediaInfo {
  const info: MediaInfo = {};
  const version = tag[3];
  const short = version === 2;
  let offset = 10;
  if (!short && tag[5] & 0x40)
    offset += version === 4 ? synchsafe(tag, 10) : view(tag).getUint32(10) + 4;
  const headerLength = short ? 6 : 10;
  while (offset + headerLength <= tag.length) {
    const id = ascii(tag, offset, short ? 3 : 4);
    if (!/^[A-Z0-9]{3,4}$/u.test(id)) break;
    const size = short
      ? (tag[offset + 3] << 16) | (tag[offset + 4] << 8) | tag[offset + 5]
      : version === 4
        ? synchsafe(tag, offset + 4)
        : view(tag).getUint32(offset + 4);
    const body = tag.subarray(
      offset + headerLength,
      offset + headerLength + size,
    );
    const field = ID3_FRAMES[id];
    if (field && info[field] === undefined)
      (info as Record<string, unknown>)[field] = id3Text(body);
    offset += headerLength + size;
  }
  return info;
}

function id3v1(bytes: Uint8Array): MediaInfo {
  if (bytes.length < 128 || !startsWith(bytes, "TAG")) return {};
  const field = (start: number) =>
    clean(decode(bytes.subarray(start, start + 30), "latin1"));
  return { title: field(3), artist: field(33), album: field(63) };
}

const MPEG_BITRATES = {
  // [version 1, version 2/2.5] × layer 1..3, in kbps.
  v1: [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  v2: [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
};
const MPEG_RATES = [44100, 48000, 32000];
const ADTS_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025,
  8000, 7350,
];

/** Reads the first MPEG audio or ADTS frame header found in `bytes`. */
export function parseAudioFrames(
  bytes: Uint8Array,
  audioBytes?: number,
): MediaInfo {
  for (let offset = 0; offset + 4 <= bytes.length; offset++) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
    const b1 = bytes[offset + 1];
    const b2 = bytes[offset + 2];
    const b3 = bytes[offset + 3];
    const layerBits = (b1 >> 1) & 3;
    if ((b1 & 0xf0) === 0xf0 && layerBits === 0) {
      const rate = ADTS_RATES[(b2 >> 2) & 0xf];
      if (!rate) continue;
      const channels = ((b2 & 1) << 2) | (b3 >> 6);
      return {
        audioCodec: "AAC",
        sampleRate: rate,
        channels: channels || undefined,
      };
    }
    const versionBits = (b1 >> 3) & 3;
    if (versionBits === 1 || layerBits === 0) continue;
    const layer = 4 - layerBits;
    const bitrateIndex = b2 >> 4;
    const rateIndex = (b2 >> 2) & 3;
    if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const version1 = versionBits === 3;
    const sampleRate =
      MPEG_RATES[rateIndex] / (version1 ? 1 : versionBits === 2 ? 2 : 4);
    const channels = b3 >> 6 === 3 ? 1 : 2;
    let bitrate =
      (version1 ? MPEG_BITRATES.v1 : MPEG_BITRATES.v2)[layer - 1][
        bitrateIndex
      ] * 1000;
    // A Xing/Info or VBRI header in the first frame gives the true average.
    const samplesPerFrame =
      layer === 1 ? 384 : layer === 3 && !version1 ? 576 : 1152;
    const sideInfo = version1
      ? channels === 1
        ? 17
        : 32
      : channels === 1
        ? 9
        : 17;
    const xing = offset + 4 + sideInfo;
    let frames: number | undefined;
    if (startsWith(bytes, "Xing", xing) || startsWith(bytes, "Info", xing)) {
      if (xing + 12 <= bytes.length && bytes[xing + 7] & 1)
        frames = view(bytes).getUint32(xing + 8);
    } else if (
      startsWith(bytes, "VBRI", offset + 36) &&
      offset + 50 <= bytes.length
    )
      frames = view(bytes).getUint32(offset + 36 + 14);
    let duration: number | undefined;
    if (frames) {
      duration = (frames * samplesPerFrame) / sampleRate;
      if (audioBytes && duration > 0)
        bitrate = Math.round((audioBytes * 8) / duration);
    }
    return {
      audioCodec: layer === 3 ? "MP3" : layer === 2 ? "MP2" : "MP1",
      sampleRate,
      channels,
      bitrate,
      duration,
    };
  }
  return {};
}

async function readMpeg(
  source: ByteSource,
  head: Uint8Array,
): Promise<MediaInfo> {
  const info: MediaInfo = {};
  let audioStart = 0;
  if (startsWith(head, "ID3") && head.length >= 10) {
    const length = 10 + synchsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
    const tag =
      length <= head.length
        ? head.subarray(0, length)
        : await source.read(0, Math.min(length, MAX_READ));
    fill(info, parseId3v2(tag));
    audioStart = length;
  }
  const frames =
    audioStart + 4096 <= head.length
      ? head.subarray(audioStart, audioStart + 4096)
      : await source.read(audioStart, 4096);
  fill(
    info,
    parseAudioFrames(
      frames,
      source.size === undefined ? undefined : source.size - audioStart,
    ),
  );
  if (
    (!info.title || !info.artist || !info.album) &&
    source.size &&
    source.size > 128
  )
    fill(info, id3v1(await source.read(source.size - 128, 128)));
  return info;
}

// ---------------------------------------------------------------------------
// WAV

const WAVE_FORMATS: Record<number, string> = {
  1: "PCM",
  3: "PCM (float)",
  6: "A-law",
  7: "μ-law",
  0x11: "IMA ADPCM",
  0x55: "MP3",
};

async function readWav(
  source: ByteSource,
  head: Uint8Array,
): Promise<MediaInfo> {
  const info: MediaInfo = {};
  let offset = 12;
  for (let count = 0; count < 64; count++) {
    const header =
      offset + 8 <= head.length
        ? head.subarray(offset, offset + 8)
        : await source.read(offset, 8);
    if (header.length < 8) break;
    const id = ascii(header, 0, 4);
    const size = view(header).getUint32(4, true);
    const bodyStart = offset + 8;
    if (id === "fmt " || id === "LIST") {
      const length = Math.min(size, 256 * 1024);
      const body =
        bodyStart + length <= head.length
          ? head.subarray(bodyStart, bodyStart + length)
          : await source.read(bodyStart, length);
      if (id === "fmt " && body.length >= 16) {
        const data = view(body);
        let format = data.getUint16(0, true);
        if (format === 0xfffe && body.length >= 26)
          format = data.getUint16(24, true);
        info.audioCodec = WAVE_FORMATS[format] ?? `0x${format.toString(16)}`;
        info.channels = data.getUint16(2, true) || undefined;
        info.sampleRate = data.getUint32(4, true) || undefined;
        info.bitrate = data.getUint32(8, true) * 8 || undefined;
        info.bitDepth = data.getUint16(14, true) || undefined;
      } else if (id === "LIST" && startsWith(body, "INFO")) {
        let at = 4;
        while (at + 8 <= body.length) {
          const tag = ascii(body, at, 4);
          const length = view(body).getUint32(at + 4, true);
          const text = clean(decode(body.subarray(at + 8, at + 8 + length)));
          if (tag === "INAM") info.title ??= text;
          else if (tag === "IART") info.artist ??= text;
          else if (tag === "IPRD") info.album ??= text;
          at += 8 + length + (length & 1);
        }
      }
    }
    offset = bodyStart + size + (size & 1);
    if (source.size !== undefined && offset >= source.size) break;
  }
  return info;
}

// ---------------------------------------------------------------------------
// FLAC

function flacStreamInfo(body: Uint8Array): MediaInfo {
  if (body.length < 18) return {};
  const sampleRate = (body[10] << 12) | (body[11] << 4) | (body[12] >> 4);
  const channels = ((body[12] >> 1) & 7) + 1;
  const bitDepth = (((body[12] & 1) << 4) | (body[13] >> 4)) + 1;
  const samples = (body[13] & 0xf) * 2 ** 32 + view(body).getUint32(14);
  return {
    audioCodec: "FLAC",
    sampleRate: sampleRate || undefined,
    channels,
    bitDepth,
    duration: sampleRate && samples ? samples / sampleRate : undefined,
  };
}

async function readFlac(
  source: ByteSource,
  head: Uint8Array,
): Promise<MediaInfo> {
  const info: MediaInfo = {};
  let offset = 4;
  for (let count = 0; count < 64; count++) {
    const header =
      offset + 4 <= head.length
        ? head.subarray(offset, offset + 4)
        : await source.read(offset, 4);
    if (header.length < 4) break;
    const type = header[0] & 0x7f;
    const size = (header[1] << 16) | (header[2] << 8) | header[3];
    const bodyStart = offset + 4;
    if (type === 0 || type === 4) {
      const length = Math.min(size, MAX_READ);
      const body =
        bodyStart + length <= head.length
          ? head.subarray(bodyStart, bodyStart + length)
          : await source.read(bodyStart, length);
      fill(info, type === 0 ? flacStreamInfo(body) : vorbisComments(body, 0));
    }
    offset = bodyStart + size;
    if (header[0] & 0x80) break;
  }
  if (info.duration && source.size)
    info.bitrate = Math.round(((source.size - offset) * 8) / info.duration);
  return info;
}

// ---------------------------------------------------------------------------
// Ogg

/** The first packets of each logical stream within `bytes`. */
function oggPackets(bytes: Uint8Array): Map<number, Uint8Array[]> {
  const streams = new Map<number, { packets: Uint8Array[]; open: number[] }>();
  let offset = 0;
  while (offset + 27 <= bytes.length && startsWith(bytes, "OggS", offset)) {
    const serial = view(bytes).getUint32(offset + 14, true);
    const segments = bytes[offset + 26];
    let data = offset + 27 + segments;
    const stream = streams.get(serial) ?? { packets: [], open: [] };
    streams.set(serial, stream);
    for (let index = 0; index < segments; index++) {
      const lace = bytes[offset + 27 + index];
      if (stream.packets.length < 3)
        for (let at = data; at < data + lace && at < bytes.length; at++)
          stream.open.push(bytes[at]);
      data += lace;
      if (lace < 255) {
        if (stream.packets.length < 3)
          stream.packets.push(Uint8Array.from(stream.open));
        stream.open = [];
      }
    }
    offset = data;
  }
  return new Map(
    [...streams].map(([serial, { packets }]) => [serial, packets]),
  );
}

export function parseOgg(bytes: Uint8Array): MediaInfo {
  const info: MediaInfo = {};
  for (const [first, second] of oggPackets(bytes).values()) {
    if (!first) continue;
    const data = view(first);
    if (startsWith(first, "\u0001vorbis") && first.length >= 24) {
      fill(info, {
        audioCodec: "Vorbis",
        channels: first[11],
        sampleRate: data.getUint32(12, true) || undefined,
        bitrate:
          data.getInt32(20, true) > 0 ? data.getInt32(20, true) : undefined,
      });
      if (second && startsWith(second, "\u0003vorbis"))
        fill(info, vorbisComments(second, 7));
    } else if (startsWith(first, "OpusHead") && first.length >= 16) {
      fill(info, {
        audioCodec: "Opus",
        channels: first[9],
        sampleRate: data.getUint32(12, true) || 48000,
      });
      if (second && startsWith(second, "OpusTags"))
        fill(info, vorbisComments(second, 8));
    } else if (startsWith(first, "\u007fFLAC") && first.length >= 13 + 4 + 18) {
      fill(info, {
        ...flacStreamInfo(first.subarray(17)),
        duration: undefined,
      });
      if (second && (second[0] & 0x7f) === 4)
        fill(info, vorbisComments(second, 4));
    } else if (startsWith(first, "\u0080theora") && first.length >= 30) {
      const numerator = data.getUint32(22);
      const denominator = data.getUint32(26);
      info.videoCodec ??= "Theora";
      if (numerator && denominator) info.frameRate ??= numerator / denominator;
      if (second && startsWith(second, "\u0081theora"))
        fill(info, vorbisComments(second, 7));
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// MP4 / QuickTime

const MP4_CODECS: Record<string, string> = {
  avc1: "H.264",
  avc3: "H.264",
  hvc1: "HEVC",
  hev1: "HEVC",
  dvh1: "HEVC (Dolby Vision)",
  dvhe: "HEVC (Dolby Vision)",
  av01: "AV1",
  vp08: "VP8",
  vp09: "VP9",
  mp4v: "MPEG-4 Visual",
  s263: "H.263",
  jpeg: "Motion JPEG",
  mjpa: "Motion JPEG",
  apch: "ProRes 422 HQ",
  apcn: "ProRes 422",
  apcs: "ProRes 422 LT",
  apco: "ProRes 422 Proxy",
  ap4h: "ProRes 4444",
  ap4x: "ProRes 4444 XQ",
  mp4a: "AAC",
  ".mp3": "MP3",
  "ac-3": "AC-3",
  "ec-3": "E-AC-3",
  alac: "ALAC",
  Opus: "Opus",
  fLaC: "FLAC",
  lpcm: "PCM",
  sowt: "PCM",
  twos: "PCM",
  samr: "AMR",
};

const QUICKTIME_TEXT: Record<string, "title" | "artist" | "album"> = {
  "©nam": "title",
  "©ART": "artist",
  "©alb": "album",
};

interface Box {
  type: string;
  /** Body start and end within the buffer. */
  start: number;
  end: number;
}

function boxes(bytes: Uint8Array, start = 0, end = bytes.length): Box[] {
  const found: Box[] = [];
  const data = view(bytes);
  let offset = start;
  while (offset + 8 <= end) {
    let size = data.getUint32(offset);
    let header = 8;
    if (size === 1 && offset + 16 <= end) {
      size = Number(data.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header) break;
    found.push({
      type: ascii(bytes, offset + 4, 4),
      start: offset + header,
      end: Math.min(end, offset + size),
    });
    offset += size;
  }
  return found;
}

function child(
  bytes: Uint8Array,
  parent: Box | undefined,
  path: string[],
): Box | undefined {
  let current = parent;
  for (const type of path) {
    if (!current) return undefined;
    current = boxes(bytes, current.start, current.end).find(
      (box) => box.type === type,
    );
  }
  return current;
}

/** Reads `meta` (ISO full box or QuickTime plain box) title/artist/album items. */
function mp4Tags(bytes: Uint8Array, meta: Box): MediaInfo {
  // An ISO `meta` is a full box: its body starts with version and flags.
  const start =
    boxes(bytes, meta.start, meta.end)[0]?.type === "hdlr"
      ? meta.start
      : meta.start + 4;
  const body: Box = { type: "meta", start, end: meta.end };
  const keys: string[] = [];
  const keyBox = child(bytes, body, ["keys"]);
  if (keyBox) {
    const data = view(bytes);
    let at = keyBox.start + 8;
    while (at + 8 <= keyBox.end) {
      const size = data.getUint32(at);
      if (size < 8) break;
      keys.push(ascii(bytes, at + 8, size - 8));
      at += size;
    }
  }
  const list = child(bytes, body, ["ilst"]);
  if (!list) return {};
  const info: MediaInfo = {};
  const view_ = view(bytes);
  for (const item of boxes(bytes, list.start, list.end)) {
    const name =
      keys.length && view_.getUint32(item.start - 4) <= keys.length
        ? keys[view_.getUint32(item.start - 4) - 1]
        : item.type;
    const field =
      name === "©nam" || name === "com.apple.quicktime.title"
        ? "title"
        : name === "©ART" ||
            name === "aART" ||
            name === "com.apple.quicktime.artist"
          ? "artist"
          : name === "©alb" || name === "com.apple.quicktime.album"
            ? "album"
            : undefined;
    if (!field || info[field]) continue;
    const data = child(bytes, item, ["data"]);
    if (data)
      info[field] = clean(decode(bytes.subarray(data.start + 8, data.end)));
  }
  return info;
}

/** Parses a `moov` box (header included). */
export function parseMoov(bytes: Uint8Array): MediaInfo {
  const info: MediaInfo = {};
  const moov = boxes(bytes).find((box) => box.type === "moov");
  if (!moov) return info;
  const data = view(bytes);
  const header = child(bytes, moov, ["mvhd"]);
  if (header) {
    const version = bytes[header.start];
    const scale = data.getUint32(header.start + (version === 1 ? 20 : 12));
    const length =
      version === 1
        ? Number(data.getBigUint64(header.start + 24))
        : data.getUint32(header.start + 16);
    if (scale && length) info.duration = length / scale;
  }
  for (const trak of boxes(bytes, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const handler = child(bytes, trak, ["mdia", "hdlr"]);
    const kind = handler && ascii(bytes, handler.start + 8, 4);
    const stbl = child(bytes, trak, ["mdia", "minf", "stbl"]);
    const stsd = child(bytes, stbl, ["stsd"]);
    if (!stsd || stsd.start + 16 > stsd.end) continue;
    const entry = stsd.start + 8;
    const format = ascii(bytes, entry + 4, 4);
    if (kind === "vide" && !info.videoCodec) {
      info.videoCodec = MP4_CODECS[format] ?? format.trim();
      const mdhd = child(bytes, trak, ["mdia", "mdhd"]);
      const stts = child(bytes, stbl, ["stts"]);
      if (mdhd && stts) {
        const version = bytes[mdhd.start];
        const scale = data.getUint32(mdhd.start + (version === 1 ? 20 : 12));
        const length =
          version === 1
            ? Number(data.getBigUint64(mdhd.start + 24))
            : data.getUint32(mdhd.start + 16);
        let samples = 0;
        const count = data.getUint32(stts.start + 4);
        for (
          let index = 0;
          index < count && stts.start + 16 + index * 8 <= stts.end;
          index++
        )
          samples += data.getUint32(stts.start + 8 + index * 8);
        if (scale && length && samples)
          info.frameRate = (samples * scale) / length;
      }
    } else if (kind === "soun" && !info.audioCodec) {
      info.audioCodec = MP4_CODECS[format] ?? format.trim();
      if (entry + 36 <= stsd.end) {
        info.channels = data.getUint16(entry + 24) || undefined;
        info.bitDepth = data.getUint16(entry + 26) || undefined;
        info.sampleRate = data.getUint32(entry + 32) / 65536 || undefined;
      }
    }
  }
  const meta =
    child(bytes, moov, ["udta", "meta"]) ?? child(bytes, moov, ["meta"]);
  if (meta) fill(info, mp4Tags(bytes, meta));
  // QuickTime also stores classic text atoms straight in `udta`.
  const userData = child(bytes, moov, ["udta"]);
  if (userData)
    for (const atom of boxes(bytes, userData.start, userData.end)) {
      const field = QUICKTIME_TEXT[atom.type];
      if (!field || info[field] || atom.start + 4 > atom.end) continue;
      const length = data.getUint16(atom.start);
      info[field] = clean(
        decode(bytes.subarray(atom.start + 4, atom.start + 4 + length)),
      );
    }
  return info;
}

async function readMp4(
  source: ByteSource,
  head: Uint8Array,
): Promise<MediaInfo> {
  let offset = 0;
  for (let count = 0; count < 64; count++) {
    const header =
      offset + 16 <= head.length
        ? head.subarray(offset, offset + 16)
        : await source.read(offset, 16);
    if (header.length < 8) break;
    const data = view(header);
    let size = data.getUint32(0);
    if (size === 1 && header.length >= 16) size = Number(data.getBigUint64(8));
    const type = ascii(header, 4, 4);
    if (type === "moov") {
      if (size > MAX_READ) return {};
      const moov =
        offset + size <= head.length
          ? head.subarray(offset, offset + size)
          : await source.read(offset, size);
      return parseMoov(moov);
    }
    if (size < 8) break;
    offset += size;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Matroska / WebM

const MATROSKA_CODECS: Record<string, string> = {
  V_VP8: "VP8",
  V_VP9: "VP9",
  V_AV1: "AV1",
  "V_MPEG4/ISO/AVC": "H.264",
  "V_MPEGH/ISO/HEVC": "HEVC",
  "V_MPEG4/ISO/ASP": "MPEG-4 Visual",
  V_THEORA: "Theora",
  V_PRORES: "ProRes",
  A_OPUS: "Opus",
  A_VORBIS: "Vorbis",
  A_FLAC: "FLAC",
  A_AC3: "AC-3",
  A_EAC3: "E-AC-3",
  A_DTS: "DTS",
  "A_MPEG/L3": "MP3",
  "A_MPEG/L2": "MP2",
  A_ALAC: "ALAC",
  A_TRUEHD: "TrueHD",
};

interface Element {
  id: number;
  start: number;
  /** Body end, clipped to the buffer; unknown sizes run to the buffer's end. */
  end: number;
  size: number;
}

function vint(
  bytes: Uint8Array,
  at: number,
  keepMarker: boolean,
): [number, number] | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  const length = Math.clz32(first) - 23;
  if (at + length > bytes.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let unknown = value === 0xff >> length;
  for (let index = 1; index < length; index++) {
    value = value * 256 + bytes[at + index];
    if (bytes[at + index] !== 0xff) unknown = false;
  }
  return [!keepMarker && unknown ? -1 : value, length];
}

function elements(bytes: Uint8Array, start: number, end: number): Element[] {
  const found: Element[] = [];
  let offset = start;
  while (offset < end) {
    const id = vint(bytes, offset, true);
    if (!id) break;
    const size = vint(bytes, offset + id[1], false);
    if (!size) break;
    const bodyStart = offset + id[1] + size[1];
    const bodyEnd = size[0] < 0 ? end : Math.min(end, bodyStart + size[0]);
    found.push({ id: id[0], start: bodyStart, end: bodyEnd, size: size[0] });
    if (size[0] < 0) break;
    offset = bodyStart + size[0];
  }
  return found;
}

function uint(bytes: Uint8Array, element: Element): number {
  let value = 0;
  for (let at = element.start; at < element.end; at++)
    value = value * 256 + bytes[at];
  return value;
}

function float(bytes: Uint8Array, element: Element): number {
  const data = view(bytes);
  const length = element.end - element.start;
  return length === 4
    ? data.getFloat32(element.start)
    : length === 8
      ? data.getFloat64(element.start)
      : 0;
}

function text(bytes: Uint8Array, element: Element): string | undefined {
  return clean(decode(bytes.subarray(element.start, element.end)));
}

const EBML = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  info: 0x1549a966,
  title: 0x7ba9,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  defaultDuration: 0x23e383,
  audio: 0xe1,
  samplingFrequency: 0xb5,
  channels: 0x9f,
  bitDepth: 0x6264,
  tags: 0x1254c367,
  tag: 0x7373,
  simpleTag: 0x67c8,
  tagName: 0x45a3,
  tagString: 0x4487,
};

function matroskaSection(
  bytes: Uint8Array,
  element: Element,
  info: MediaInfo,
): void {
  const children = elements(bytes, element.start, element.end);
  const find = (id: number, list = children) =>
    list.find((item) => item.id === id);
  if (element.id === EBML.info) {
    const title = find(EBML.title);
    if (title) info.title ??= text(bytes, title);
    const duration = find(EBML.duration);
    const scale = find(EBML.timecodeScale);
    if (duration)
      info.duration ??=
        (float(bytes, duration) * (scale ? uint(bytes, scale) : 1_000_000)) /
        1e9;
  } else if (element.id === EBML.tracks) {
    for (const entry of children) {
      if (entry.id !== EBML.trackEntry) continue;
      const fields = elements(bytes, entry.start, entry.end);
      const type = find(EBML.trackType, fields);
      const codec = find(EBML.codecId, fields);
      const codecName = codec && text(bytes, codec);
      const name =
        codecName &&
        (MATROSKA_CODECS[codecName] ?? codecName.replace(/^[AV]_/u, ""));
      if (type && uint(bytes, type) === 1 && !info.videoCodec) {
        info.videoCodec = name;
        const frame = find(EBML.defaultDuration, fields);
        if (frame && uint(bytes, frame))
          info.frameRate = 1e9 / uint(bytes, frame);
      } else if (type && uint(bytes, type) === 2 && !info.audioCodec) {
        info.audioCodec = name;
        const audio = find(EBML.audio, fields);
        if (audio) {
          const settings = elements(bytes, audio.start, audio.end);
          const rate = find(EBML.samplingFrequency, settings);
          const channels = find(EBML.channels, settings);
          const depth = find(EBML.bitDepth, settings);
          if (rate) info.sampleRate = float(bytes, rate) || undefined;
          info.channels = channels ? uint(bytes, channels) : 1;
          if (depth) info.bitDepth = uint(bytes, depth) || undefined;
        }
      }
    }
  } else if (element.id === EBML.tags) {
    for (const tag of children) {
      if (tag.id !== EBML.tag) continue;
      for (const simple of elements(bytes, tag.start, tag.end)) {
        if (simple.id !== EBML.simpleTag) continue;
        const fields = elements(bytes, simple.start, simple.end);
        const name = find(EBML.tagName, fields);
        const value = find(EBML.tagString, fields);
        if (!name || !value) continue;
        const key = text(bytes, name)?.toUpperCase();
        const field =
          key === "TITLE"
            ? "title"
            : key === "ARTIST"
              ? "artist"
              : key === "ALBUM"
                ? "album"
                : undefined;
        if (field) info[field] ??= text(bytes, value);
      }
    }
  }
}

async function readMatroska(
  source: ByteSource,
  head: Uint8Array,
): Promise<MediaInfo> {
  const info: MediaInfo = {};
  const top = elements(head, 0, head.length);
  const segment = top.find((element) => element.id === EBML.segment);
  if (!segment) return info;
  const seen = new Set<number>();
  const wanted = [EBML.info, EBML.tracks, EBML.tags];
  const seeks: { id: number; position: number }[] = [];
  for (const element of elements(head, segment.start, segment.end)) {
    // Only sections wholly inside the first read; the rest come from seeks.
    if (element.size < 0 || element.start + element.size > head.length) break;
    if (element.id === EBML.seekHead)
      for (const seek of elements(head, element.start, element.end)) {
        if (seek.id !== EBML.seek) continue;
        const fields = elements(head, seek.start, seek.end);
        const id = fields.find((field) => field.id === EBML.seekId);
        const position = fields.find((field) => field.id === EBML.seekPosition);
        if (id && position)
          seeks.push({ id: uint(head, id), position: uint(head, position) });
      }
    else if (wanted.includes(element.id)) {
      matroskaSection(head, element, info);
      seen.add(element.id);
    }
  }
  for (const { id, position } of seeks) {
    if (!wanted.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const at = segment.start + position;
    const header = await source.read(at, 12);
    const parsed = elements(header, 0, header.length)[0];
    if (!parsed || parsed.id !== id || parsed.size < 0) continue;
    const length = parsed.start + parsed.size;
    if (length > 1024 * 1024) continue;
    const bytes = await source.read(at, length);
    const element = elements(bytes, 0, bytes.length)[0];
    if (element) matroskaSection(bytes, element, info);
  }
  return info;
}

// ---------------------------------------------------------------------------

/** Reads a media file's header metadata; parse failures leave fields out. */
export async function readMediaInfo(source: ByteSource): Promise<MediaInfo> {
  const head = await source.read(0, HEAD);
  let info: MediaInfo = {};
  if (startsWith(head, "RIFF") && startsWith(head, "WAVE", 8))
    info = await readWav(source, head);
  else if (startsWith(head, "fLaC")) info = await readFlac(source, head);
  else if (startsWith(head, "OggS")) info = parseOgg(head);
  else if (startsWith(head, "\u001aEß£"))
    info = await readMatroska(source, head);
  else if (
    startsWith(head, "ftyp", 4) ||
    startsWith(head, "moov", 4) ||
    startsWith(head, "wide", 4) ||
    startsWith(head, "mdat", 4)
  )
    info = await readMp4(source, head);
  else info = await readMpeg(source, head);
  return info;
}

function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** Human-readable sample rate: "44.1 kHz", "48 kHz", "8 kHz". */
export function formatSampleRate(hertz: number): string {
  return hertz >= 1000
    ? `${trimNumber(hertz / 1000, 2)} kHz`
    : `${Math.round(hertz)} Hz`;
}

export function formatBitrate(bitsPerSecond: number): string {
  return bitsPerSecond >= 10_000_000
    ? `${trimNumber(bitsPerSecond / 1_000_000, 1)} Mbps`
    : `${Math.round(bitsPerSecond / 1000)} kbps`;
}

/**
 * Turns media info into Details properties. `duration` (from the media
 * element) and `size` give an overall bitrate when the header has none.
 */
export function mediaProperties(
  info: MediaInfo,
  kind: "audio" | "video",
  overall: { duration?: number; size?: number } = {},
): PreviewProperty[] {
  const properties: PreviewProperty[] = [];
  const push = (key: PreviewProperty["key"], value: string | undefined) => {
    if (value) properties.push({ key, value });
  };
  push("title", info.title);
  push("artist", info.artist);
  push("album", info.album);
  push(
    "codec",
    kind === "video"
      ? [info.videoCodec, info.audioCodec].filter(Boolean).join(" / ")
      : info.audioCodec,
  );
  if (kind === "video" && info.frameRate && Number.isFinite(info.frameRate))
    push("frameRate", `${trimNumber(info.frameRate, 2)} fps`);
  const duration =
    overall.duration && Number.isFinite(overall.duration)
      ? overall.duration
      : info.duration;
  // Video headers rarely record a total; the file's average is what players show.
  const bitrate =
    (kind === "audio" ? info.bitrate : undefined) ??
    (duration && overall.size ? (overall.size * 8) / duration : undefined) ??
    info.bitrate;
  if (bitrate && Number.isFinite(bitrate))
    push("bitrate", formatBitrate(bitrate));
  if (info.sampleRate) push("sampleRate", formatSampleRate(info.sampleRate));
  if (info.channels === 6) push("channels", "5.1");
  else if (info.channels === 8) push("channels", "7.1");
  else if (info.channels)
    properties.push({ key: "channels", type: "number", value: info.channels });
  const lossless = /^(PCM|FLAC|ALAC)/u.test(info.audioCodec ?? "");
  if (kind === "audio" && info.bitDepth && lossless)
    properties.push({ key: "bitDepth", type: "number", value: info.bitDepth });
  return properties;
}
