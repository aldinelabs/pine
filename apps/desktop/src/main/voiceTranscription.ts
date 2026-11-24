// On-device transcription of one voice recording (a WeChat voice message
// that came without the server's transcript): decode it to a file macOS can
// read, run the Live Context helper once with `--transcribe`, read the one
// transcript it prints. Nothing is kept: the decoded file is deleted as soon
// as the helper is done, and the text goes only to the caller.

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** A recording as it arrived, with what the sender's client said about it. */
export interface VoiceClip {
  data: Buffer;
  /** WeChat's `encode_type`: 1 pcm, 2 adpcm, 3 feature, 4 speex, 5 amr, 6 silk, 7 mp3, 8 ogg-speex. */
  encodeType?: number;
  /** Hz, for raw PCM. */
  sampleRate?: number;
  /** Milliseconds, as the sender's client measured it. */
  playtimeMs?: number;
}

export interface VoiceTranscript {
  text: string;
  /** The language it was transcribed in (BCP 47). */
  locale: string;
}

/** WeChat records at most 60 seconds; a little more for rounding. */
export const VOICE_MAX_MS = 65_000;
/** 60 s of 16 kHz PCM is about 1.9 MB; SILK and MP3 are far smaller. */
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
/** The whole transcription, the language-asset check included. */
export const VOICE_TRANSCRIBE_TIMEOUT_MS = 45_000;

/** The recording's format cannot be decoded here. */
export class VoiceFormatError extends Error {
  constructor(message = "The voice message's audio format is not supported.") {
    super(message);
    this.name = "VoiceFormatError";
  }
}

const SILK_MAGIC = Buffer.from("#!SILK_V3", "latin1");
/** SILK decodes at this rate; the transcriber wants 16 kHz anyway. */
const SILK_RATE = 16_000;

function startsWith(data: Buffer, prefix: Buffer, at = 0): boolean {
  return (
    data.length >= at + prefix.length &&
    data.subarray(at, at + prefix.length).equals(prefix)
  );
}

/**
 * SILK in the form the decoder reads, `0x02` then `#!SILK_V3`: WeChat sends
 * it with the `0x02` in front, other clients without. Undefined when the
 * data is not SILK.
 */
export function tencentSilk(data: Buffer): Buffer | undefined {
  if (data[0] === 0x02 && startsWith(data, SILK_MAGIC, 1)) return data;
  if (startsWith(data, SILK_MAGIC)) {
    return Buffer.concat([Buffer.from([0x02]), data]);
  }
  return undefined;
}

/** Mono 16-bit little-endian PCM as a WAV file. */
export function wavFile(pcm: Uint8Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm)]);
}

type SilkDecode = (
  input: Uint8Array,
  sampleRate: number,
) => Promise<{ data: Uint8Array; duration: number }>;

async function silkDecoder(): Promise<SilkDecode> {
  const silk = await import("silk-wasm");
  return silk.decode;
}

/**
 * The recording as a file the helper can read: SILK and raw PCM become WAV,
 * MP3, AMR and WAV pass through (Core Audio reads them). The data decides
 * over `encodeType`, which clients do not always fill in.
 */
export async function decodeVoice(
  clip: VoiceClip,
  decodeSilk: () => Promise<SilkDecode> = silkDecoder,
): Promise<{ data: Buffer; extension: "wav" | "mp3" | "amr" }> {
  const { data } = clip;
  if (data.length === 0) throw new VoiceFormatError("The recording is empty.");
  const silk = tencentSilk(data);
  if (silk) {
    const decode = await decodeSilk();
    let decoded: { data: Uint8Array };
    try {
      decoded = await decode(silk, SILK_RATE);
    } catch {
      throw new VoiceFormatError("The SILK recording could not be decoded.");
    }
    if (decoded.data.byteLength === 0) {
      throw new VoiceFormatError("The SILK recording is empty.");
    }
    return { data: wavFile(decoded.data, SILK_RATE), extension: "wav" };
  }
  if (startsWith(data, Buffer.from("RIFF", "latin1"))) {
    return { data, extension: "wav" };
  }
  if (startsWith(data, Buffer.from("#!AMR", "latin1"))) {
    return { data, extension: "amr" };
  }
  if (
    clip.encodeType === 7 ||
    startsWith(data, Buffer.from("ID3", "latin1")) ||
    (data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0)
  ) {
    return { data, extension: "mp3" };
  }
  if (clip.encodeType === 1) {
    const rate = clip.sampleRate;
    const sampleRate =
      rate !== undefined &&
      Number.isInteger(rate) &&
      rate >= 8000 &&
      rate <= 48_000
        ? rate
        : SILK_RATE;
    // An odd byte is half a sample.
    return {
      data: wavFile(
        data.subarray(0, data.length - (data.length % 2)),
        sampleRate,
      ),
      extension: "wav",
    };
  }
  throw new VoiceFormatError();
}

/** What `--transcribe` printed, as far as Pine cares. */
export function parseHelperOutput(stdout: string): VoiceTranscript | undefined {
  let error: string | undefined;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null) continue;
    const record = event as Record<string, unknown>;
    if (record.type === "transcript" && typeof record.text === "string") {
      const text = record.text.trim();
      if (!text) return undefined;
      return {
        text,
        locale: typeof record.locale === "string" ? record.locale : "",
      };
    }
    if (record.type === "error") {
      error = typeof record.code === "string" ? record.code : "error";
    }
  }
  if (error !== undefined) {
    throw new Error(`The transcription helper failed (${error}).`);
  }
  return undefined;
}

/** The parts of a child process `runHelper` needs (tests pass a fake). */
export interface TranscribeProcess {
  stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): unknown;
  } | null;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

export interface VoiceTranscriberOptions {
  /** False when this Mac cannot transcribe (not macOS 26+, no helper). */
  available(): boolean;
  /** Starts `pine-live-context --transcribe <file> --locale <locale>`. */
  spawn(args: readonly string[]): TranscribeProcess;
  /** The language to try first (a Live Context locale). */
  locale(): string;
  /** A private folder for the decoded file; it is deleted right after. */
  temporaryDirectory: string;
  timeoutMs?: number;
  decodeSilk?: () => Promise<SilkDecode>;
}

/** Transcribes one clip, or resolves undefined when nothing was said. */
export type VoiceTranscriber = (
  clip: VoiceClip,
  signal?: AbortSignal,
) => Promise<VoiceTranscript | undefined>;

function runHelper(
  child: TranscribeProcess,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    const abort = () => finish(new Error("The transcription was cancelled."));
    const timer = setTimeout(
      () => finish(new Error("The transcription timed out.")),
      timeoutMs,
    );
    timer.unref?.();
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      chunks.push(chunk);
    });
    child.once("error", (error) => finish(error));
    child.once("close", () => finish());
  });
}

/** Undefined when on-device transcription cannot run here. */
export function createVoiceTranscriber(
  options: VoiceTranscriberOptions,
): VoiceTranscriber | undefined {
  if (!options.available()) return undefined;
  const timeoutMs = options.timeoutMs ?? VOICE_TRANSCRIBE_TIMEOUT_MS;
  return async (clip, signal) => {
    if (clip.data.length > VOICE_MAX_BYTES) {
      throw new VoiceFormatError("The recording is too large.");
    }
    if (clip.playtimeMs !== undefined && clip.playtimeMs > VOICE_MAX_MS) {
      throw new VoiceFormatError("The recording is too long.");
    }
    const decoded = await decodeVoice(clip, options.decodeSilk);
    await mkdir(options.temporaryDirectory, { recursive: true, mode: 0o700 });
    const file = path.join(
      options.temporaryDirectory,
      `${randomUUID()}.${decoded.extension}`,
    );
    await writeFile(file, decoded.data, { mode: 0o600 });
    try {
      const child = options.spawn([
        "--transcribe",
        file,
        "--locale",
        options.locale(),
      ]);
      return parseHelperOutput(await runHelper(child, timeoutMs, signal));
    } finally {
      await rm(file, { force: true });
    }
  };
}
