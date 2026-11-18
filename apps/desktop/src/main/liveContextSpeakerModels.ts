import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The speaker-label models, downloaded the first time someone turns speaker
 * labels on (about 35 MB) instead of shipping with every copy of Pine. Each
 * is pinned by URL and SHA-256 and checked before the helper may load it;
 * nothing downloaded is ever executed (they are ONNX weights).
 */
export interface SpeakerModel {
  /** Name in the models folder. */
  file: string;
  url: string;
  /** Of the model file itself. */
  sha256: string;
  bytes: number;
  /** The model comes inside this archive. */
  archive?: { sha256: string; bytes: number; member: string };
}

export const SPEAKER_MODELS = {
  /** pyannote segmentation-3.0 (MIT), sherpa-onnx's int8 export. */
  segmentation: {
    file: "pyannote-segmentation-3.0.int8.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    sha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
    bytes: 1_540_506,
    archive: {
      sha256:
        "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
      bytes: 6_958_444,
      member: "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx",
    },
  },
  /** 3D-Speaker CAM++ (Apache-2.0), trained on Chinese and English. */
  embedding: {
    file: "3dspeaker-campplus-zh-en-16k-advanced.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    bytes: 28_281_164,
  },
} as const satisfies Record<string, SpeakerModel>;

export type SpeakerModelPaths = Record<keyof typeof SPEAKER_MODELS, string>;

export interface SpeakerModelOptions {
  /** Holds the models, e.g. `<userData>/models/live-context-speakers`. */
  directory: string;
  /** Pine's own outgoing requests (the desktop follows the system proxy). */
  fetch: (url: string) => Promise<Response>;
  /** Copies one member of a .tar.bz2 archive to `destination`. */
  extract(archive: string, member: string, destination: string): Promise<void>;
  /** 0–1 across all downloads. */
  onProgress?(fraction: number): void;
  /** Tests only: other pins. */
  models?: Record<keyof typeof SPEAKER_MODELS, SpeakerModel>;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function isIntact(file: string, model: SpeakerModel): Promise<boolean> {
  try {
    if ((await stat(file)).size !== model.bytes) return false;
  } catch {
    return false;
  }
  return (await sha256(file)) === model.sha256;
}

/** Streams `url` to `file`, refusing more bytes than expected or a wrong hash. */
async function download(
  fetch: SpeakerModelOptions["fetch"],
  url: string,
  file: string,
  expected: { bytes: number; sha256: string },
  onBytes: (bytes: number) => void,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`Download failed (HTTP ${response.status}).`);
  const hash = createHash("sha256");
  const handle = await open(file, "w");
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expected.bytes) {
        await reader.cancel();
        throw new Error("The download is larger than expected.");
      }
      hash.update(value);
      await handle.write(value);
      onBytes(value.byteLength);
    }
  } finally {
    await handle.close();
  }
  if (received !== expected.bytes || hash.digest("hex") !== expected.sha256)
    throw new Error("The download does not match its checksum.");
}

/** The models' paths when both are present and intact. */
export async function readySpeakerModels(
  directory: string,
  models: Record<keyof typeof SPEAKER_MODELS, SpeakerModel> = SPEAKER_MODELS,
): Promise<SpeakerModelPaths | undefined> {
  const paths = {
    segmentation: path.join(directory, models.segmentation.file),
    embedding: path.join(directory, models.embedding.file),
  };
  const intact = await Promise.all([
    isIntact(paths.segmentation, models.segmentation),
    isIntact(paths.embedding, models.embedding),
  ]);
  return intact.every(Boolean) ? paths : undefined;
}

/** Downloads whichever model is missing or damaged, then returns both. */
export async function ensureSpeakerModels(
  options: SpeakerModelOptions,
): Promise<SpeakerModelPaths> {
  const pins = options.models ?? SPEAKER_MODELS;
  const ready = await readySpeakerModels(options.directory, pins);
  if (ready) return ready;
  await mkdir(options.directory, { recursive: true });
  const missing: SpeakerModel[] = [];
  for (const model of Object.values(pins))
    if (!(await isIntact(path.join(options.directory, model.file), model)))
      missing.push(model);
  const total = missing.reduce(
    (sum, model) => sum + (model.archive?.bytes ?? model.bytes),
    0,
  );
  let done = 0;
  const progress = (bytes: number) => {
    done += bytes;
    options.onProgress?.(Math.min(1, done / total));
  };
  options.onProgress?.(0);
  const staging = await mkdtemp(path.join(options.directory, ".download-"));
  try {
    for (const model of missing) {
      const target = path.join(options.directory, model.file);
      const partial = path.join(staging, model.file);
      if (model.archive) {
        const archive = path.join(staging, `${model.file}.tar.bz2`);
        await download(
          options.fetch,
          model.url,
          archive,
          model.archive,
          progress,
        );
        await options.extract(archive, model.archive.member, partial);
      } else {
        await download(options.fetch, model.url, partial, model, progress);
      }
      if (!(await isIntact(partial, model)))
        throw new Error(`${model.file} does not match its checksum.`);
      await rename(partial, target);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const paths = await readySpeakerModels(options.directory, pins);
  if (!paths) throw new Error("The speaker models could not be installed.");
  return paths;
}
