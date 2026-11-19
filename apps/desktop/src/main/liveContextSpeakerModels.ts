import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The speaker-label models, downloaded the first time someone turns speaker
 * labels on (about 30 MB) instead of shipping with every copy of Pine. Each
 * is pinned by size and SHA-256 and checked before the helper may load it;
 * nothing downloaded is ever executed (they are ONNX weights).
 *
 * The URLs name a Hugging Face commit, so the bytes behind them cannot
 * change. sherpa-onnx's GitHub release assets can: on 2026-11-19 every
 * CAM++ asset there was re-uploaded one byte longer, which made every
 * first download fail its pin.
 */
export interface SpeakerModel {
  /** Name in the models folder. */
  file: string;
  /** The same bytes from several places, tried in order. */
  urls: readonly string[];
  sha256: string;
  bytes: number;
}

/** Hugging Face, then its mirror for networks that cannot reach it. */
function pinned(repo: string, commit: string, file: string): string[] {
  return ["https://huggingface.co", "https://hf-mirror.com"].map(
    (host) => `${host}/${repo}/resolve/${commit}/${file}`,
  );
}

export const SPEAKER_MODELS = {
  /** pyannote segmentation-3.0 (MIT), sherpa-onnx's int8 export. */
  segmentation: {
    file: "pyannote-segmentation-3.0.int8.onnx",
    urls: pinned(
      "csukuangfj/sherpa-onnx-pyannote-segmentation-3-0",
      "9403a6902bb58e3d5ae8c7e77c3422de279db2e0",
      "model.int8.onnx",
    ),
    sha256: "d582f4b4c6b48205de7e0643c57df0df5615a3c176189be3fc461e9d18827b5d",
    bytes: 1_540_506,
  },
  /** 3D-Speaker CAM++ (Apache-2.0), trained on Chinese and English. */
  embedding: {
    file: "3dspeaker-campplus-zh-en-16k-advanced.onnx",
    urls: pinned(
      "csukuangfj/speaker-embedding-models",
      "0743f301363dec56491a490f6d6cbc9d67f9a3bf",
      "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    ),
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    bytes: 28_281_164,
  },
} as const satisfies Record<string, SpeakerModel>;

export type SpeakerModelPaths = Record<keyof typeof SPEAKER_MODELS, string>;

/** Why the models could not be had, for a message the user can act on. */
export type SpeakerModelFailure = "network" | "size" | "checksum" | "disk";

export class SpeakerModelError extends Error {
  constructor(
    readonly reason: SpeakerModelFailure,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SpeakerModelError";
  }
}

export interface SpeakerModelOptions {
  /** Holds the models, e.g. `<userData>/models/live-context-speakers`. */
  directory: string;
  /** Pine's own outgoing requests (the desktop follows the system proxy). */
  fetch: (url: string, init: { signal?: AbortSignal }) => Promise<Response>;
  /** Bytes so far across all downloads, of `total`. */
  onProgress?(received: number, total: number): void;
  /** Gives up: the download stops and `ensureSpeakerModels` rejects. */
  signal?: AbortSignal;
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

/** File-system trouble (full disk, no permission), not the download's. */
async function onDisk<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof SpeakerModelError) throw error;
    throw new SpeakerModelError(
      "disk",
      `Could not write the speaker models: ${String(error)}`,
      { cause: error },
    );
  }
}

/**
 * Streams `url` to `file`, refusing more bytes than pinned or a wrong hash.
 * `onBytes` goes back down when this attempt fails, so the next source's
 * progress starts where this one did.
 */
async function download(
  fetch: SpeakerModelOptions["fetch"],
  signal: AbortSignal | undefined,
  url: string,
  file: string,
  model: SpeakerModel,
  onBytes: (bytes: number) => void,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw new SpeakerModelError("network", `${url}: ${String(error)}`, {
      cause: error,
    });
  }
  if (!response.ok || !response.body)
    throw new SpeakerModelError("network", `${url}: HTTP ${response.status}`);
  const hash = createHash("sha256");
  const handle = await onDisk(() => open(file, "w"));
  let received = 0;
  // What `onBytes` heard, to take back if this attempt fails.
  let reported = 0;
  const takeBack = () => {
    onBytes(-reported);
    reported = 0;
  };
  try {
    const reader = response.body.getReader();
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw new SpeakerModelError("network", `${url}: ${String(error)}`, {
          cause: error,
        });
      }
      if (chunk.done) break;
      const value = chunk.value;
      received += value.byteLength;
      if (received > model.bytes) {
        await reader.cancel().catch(() => undefined);
        throw new SpeakerModelError(
          "size",
          `${url}: more than the pinned ${model.bytes} bytes`,
        );
      }
      hash.update(value);
      await onDisk(() => handle.write(value));
      reported += value.byteLength;
      onBytes(value.byteLength);
    }
  } catch (error) {
    takeBack();
    throw error;
  } finally {
    await handle.close();
  }
  if (received !== model.bytes) {
    takeBack();
    throw new SpeakerModelError(
      "size",
      `${url}: ${received} bytes, pinned ${model.bytes}`,
    );
  }
  const digest = hash.digest("hex");
  if (digest !== model.sha256) {
    takeBack();
    throw new SpeakerModelError(
      "checksum",
      `${url}: SHA-256 ${digest}, pinned ${model.sha256}`,
    );
  }
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

/**
 * Downloads whichever model is missing or damaged, then returns both. Each
 * model's sources are tried in turn; a source with the wrong bytes counts
 * as failed like one that cannot be reached. Throws a `SpeakerModelError`.
 */
export async function ensureSpeakerModels(
  options: SpeakerModelOptions,
): Promise<SpeakerModelPaths> {
  const pins = options.models ?? SPEAKER_MODELS;
  const ready = await readySpeakerModels(options.directory, pins);
  if (ready) return ready;
  await onDisk(() => mkdir(options.directory, { recursive: true }));
  const missing: SpeakerModel[] = [];
  for (const model of Object.values(pins))
    if (!(await isIntact(path.join(options.directory, model.file), model)))
      missing.push(model);
  const total = missing.reduce((sum, model) => sum + model.bytes, 0);
  let done = 0;
  const progress = (bytes: number) => {
    done = Math.min(total, Math.max(0, done + bytes));
    options.onProgress?.(done, total);
  };
  options.onProgress?.(0, total);
  const staging = await onDisk(() =>
    mkdtemp(path.join(options.directory, ".download-")),
  );
  try {
    for (const model of missing) {
      const partial = path.join(staging, model.file);
      let failure: Error | undefined;
      for (const url of model.urls) {
        options.signal?.throwIfAborted();
        try {
          await download(
            options.fetch,
            options.signal,
            url,
            partial,
            model,
            progress,
          );
          failure = undefined;
          break;
        } catch (error) {
          // Given up, or the disk will not do better with the next source.
          options.signal?.throwIfAborted();
          if (error instanceof SpeakerModelError && error.reason === "disk")
            throw error;
          failure = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (failure) throw failure;
      await onDisk(() =>
        rename(partial, path.join(options.directory, model.file)),
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  const paths = await readySpeakerModels(options.directory, pins);
  if (!paths)
    throw new SpeakerModelError(
      "disk",
      "The speaker models changed after they were saved.",
    );
  return paths;
}
