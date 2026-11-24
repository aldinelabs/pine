// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encode } from "silk-wasm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VOICE_MAX_BYTES,
  VoiceFormatError,
  createVoiceTranscriber,
  decodeVoice,
  parseHelperOutput,
  tencentSilk,
  wavFile,
  type TranscribeProcess,
} from "../voiceTranscription";

/** One second of a 440 Hz tone, 24 kHz mono 16-bit. */
function tone(sampleRate = 24_000): Buffer {
  const samples = Buffer.alloc(sampleRate * 2);
  for (let index = 0; index < sampleRate; index += 1) {
    const value = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 12_000;
    samples.writeInt16LE(Math.round(value), index * 2);
  }
  return samples;
}

class FakeProcess extends EventEmitter implements TranscribeProcess {
  readonly stdout = new EventEmitter();
  killed = false;
  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null));
    return true;
  }
  print(lines: unknown[]): void {
    for (const line of lines) {
      this.stdout.emit("data", Buffer.from(`${JSON.stringify(line)}\n`));
    }
    this.emit("close", 0);
  }
}

describe("decoding", () => {
  it("adds WeChat's 0x02 in front of plain SILK and recognises other data", () => {
    const tencent = Buffer.from("\x02#!SILK_V3rest", "latin1");
    expect(tencentSilk(tencent)).toBe(tencent);
    expect(tencentSilk(Buffer.from("#!SILK_V3rest", "latin1"))).toEqual(
      tencent,
    );
    expect(tencentSilk(Buffer.from("ID3...", "latin1"))).toBeUndefined();
  });

  it("writes mono 16-bit WAV", () => {
    const wav = wavFile(new Uint8Array(8), 16_000);
    expect(wav.length).toBe(52);
    expect(wav.toString("latin1", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(44);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(40)).toBe(8);
  });

  it("decodes real SILK, with and without WeChat's prefix, to 16 kHz WAV", async () => {
    const silk = Buffer.from((await encode(tone(), 24_000)).data);
    expect(silk.toString("latin1", 0, 10)).toBe("\x02#!SILK_V3");
    for (const data of [silk, silk.subarray(1)]) {
      const decoded = await decodeVoice({ data, encodeType: 6 });
      expect(decoded.extension).toBe("wav");
      expect(decoded.data.readUInt32LE(24)).toBe(16_000);
      // About one second of audio.
      const seconds = decoded.data.readUInt32LE(40) / 2 / 16_000;
      expect(seconds).toBeGreaterThan(0.9);
      expect(seconds).toBeLessThan(1.1);
    }
  });

  it("wraps raw PCM at its sample rate and passes MP3, AMR and WAV through", async () => {
    const pcm = await decodeVoice({
      data: Buffer.alloc(9),
      encodeType: 1,
      sampleRate: 8000,
    });
    expect(pcm.extension).toBe("wav");
    expect(pcm.data.readUInt32LE(24)).toBe(8000);
    expect(pcm.data.readUInt32LE(40)).toBe(8);
    const mp3 = Buffer.from("ID3\x04rest", "latin1");
    expect(await decodeVoice({ data: mp3 })).toEqual({
      data: mp3,
      extension: "mp3",
    });
    expect(
      (await decodeVoice({ data: Buffer.from([0xff, 0xfb, 0x90]) })).extension,
    ).toBe("mp3");
    expect(
      (await decodeVoice({ data: Buffer.from("#!AMR\n", "latin1") })).extension,
    ).toBe("amr");
    expect(
      (await decodeVoice({ data: wavFile(new Uint8Array(2), 8000) })).extension,
    ).toBe("wav");
  });

  it("refuses formats macOS cannot read and broken SILK", async () => {
    await expect(
      decodeVoice({ data: Buffer.from("speex"), encodeType: 4 }),
    ).rejects.toBeInstanceOf(VoiceFormatError);
    await expect(decodeVoice({ data: Buffer.alloc(0) })).rejects.toBeInstanceOf(
      VoiceFormatError,
    );
    await expect(
      decodeVoice({ data: Buffer.from("\x02#!SILK_V3\xff\xff", "latin1") }),
    ).rejects.toBeInstanceOf(VoiceFormatError);
  });
});

describe("the helper's output", () => {
  it("reads the transcript and ignores the other lines", () => {
    const stdout = [
      { type: "ready", protocol: 1 },
      { type: "status", state: "downloading", progress: 0.5 },
      { type: "transcript", text: " 帮我看一下 ", locale: "zh-CN" },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    expect(parseHelperOutput(`${stdout}\nnot json\n`)).toEqual({
      text: "帮我看一下",
      locale: "zh-CN",
    });
  });

  it("is empty when nothing was said and fails on an error", () => {
    expect(
      parseHelperOutput(JSON.stringify({ type: "transcript", text: "  " })),
    ).toBeUndefined();
    expect(parseHelperOutput("")).toBeUndefined();
    expect(() =>
      parseHelperOutput(
        JSON.stringify({ type: "error", code: "unavailable", message: "x" }),
      ),
    ).toThrow("unavailable");
  });
});

describe("one transcription", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), "pine-voice-test-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(folder, { recursive: true, force: true });
  });

  it("is unavailable where the helper cannot run", () => {
    expect(
      createVoiceTranscriber({
        available: () => false,
        spawn: () => new FakeProcess(),
        locale: () => "zh-CN",
        temporaryDirectory: folder,
      }),
    ).toBeUndefined();
  });

  it("runs the helper on a decoded file and deletes it afterwards", async () => {
    const child = new FakeProcess();
    let seen: { args: readonly string[]; bytes: Buffer } | undefined;
    const transcribe = createVoiceTranscriber({
      available: () => true,
      spawn: (args) => {
        const file = args[1] ?? "";
        void readFile(file).then((bytes) => {
          seen = { args, bytes };
          child.print([
            { type: "ready" },
            { type: "transcript", text: "run the tests", locale: "en-US" },
          ]);
        });
        return child;
      },
      locale: () => "en-US",
      temporaryDirectory: path.join(folder, "voice"),
    });
    const pcm = Buffer.alloc(32);
    const result = await transcribe?.({
      data: pcm,
      encodeType: 1,
      sampleRate: 16_000,
    });
    expect(result).toEqual({ text: "run the tests", locale: "en-US" });
    expect(seen?.args[0]).toBe("--transcribe");
    expect(seen?.args[1]?.endsWith(".wav")).toBe(true);
    expect(seen?.args.slice(2)).toEqual(["--locale", "en-US"]);
    expect(seen?.bytes).toEqual(wavFile(pcm, 16_000));
    expect(existsSync(seen?.args[1] ?? "")).toBe(false);
    expect(await readdir(path.join(folder, "voice"))).toEqual([]);
  });

  it("kills a helper that takes too long or is cancelled", async () => {
    const slow = new FakeProcess();
    const transcribe = createVoiceTranscriber({
      available: () => true,
      spawn: () => slow,
      locale: () => "zh-CN",
      temporaryDirectory: folder,
      timeoutMs: 20,
    });
    await expect(
      transcribe?.({ data: Buffer.alloc(4), encodeType: 1 }),
    ).rejects.toThrow("timed out");
    expect(slow.killed).toBe(true);

    const cancelled = new FakeProcess();
    const controller = new AbortController();
    const cancellable = createVoiceTranscriber({
      available: () => true,
      spawn: () => {
        queueMicrotask(() => controller.abort());
        return cancelled;
      },
      locale: () => "zh-CN",
      temporaryDirectory: folder,
    });
    await expect(
      cancellable?.(
        { data: Buffer.alloc(4), encodeType: 1 },
        controller.signal,
      ),
    ).rejects.toThrow("cancelled");
    expect(cancelled.killed).toBe(true);
    expect(await readdir(folder)).toEqual([]);
  });

  it("refuses recordings over the limits without starting the helper", async () => {
    const spawn = vi.fn(() => new FakeProcess());
    const transcribe = createVoiceTranscriber({
      available: () => true,
      spawn,
      locale: () => "zh-CN",
      temporaryDirectory: folder,
    });
    await expect(
      transcribe?.({ data: Buffer.alloc(VOICE_MAX_BYTES + 1), encodeType: 1 }),
    ).rejects.toBeInstanceOf(VoiceFormatError);
    await expect(
      transcribe?.({
        data: Buffer.alloc(4),
        encodeType: 1,
        playtimeMs: 120_000,
      }),
    ).rejects.toBeInstanceOf(VoiceFormatError);
    expect(spawn).not.toHaveBeenCalled();
  });
});
