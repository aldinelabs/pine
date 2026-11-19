import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSpeakerModels,
  readySpeakerModels,
  SPEAKER_MODELS,
  SpeakerModelError,
  type SpeakerModel,
} from "../liveContextSpeakerModels";

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

const segmentation = Buffer.from("segmentation weights");
const embedding = Buffer.from("embedding weights, a little longer");

const MODELS: Record<keyof typeof SPEAKER_MODELS, SpeakerModel> = {
  segmentation: {
    file: "segmentation.onnx",
    urls: ["https://example.test/segmentation.onnx"],
    sha256: sha256(segmentation),
    bytes: segmentation.length,
  },
  embedding: {
    file: "embedding.onnx",
    urls: [
      "https://example.test/embedding.onnx",
      "https://mirror.example.test/embedding.onnx",
    ],
    sha256: sha256(embedding),
    bytes: embedding.length,
  },
};
const [EMBEDDING, MIRROR] = MODELS.embedding.urls as [string, string];

async function failure(promise: Promise<unknown>): Promise<SpeakerModelError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SpeakerModelError);
  return error as SpeakerModelError;
}

describe("speaker models", () => {
  let directory: string;
  let bodies: Record<string, Buffer | Error>;
  const fetch = vi.fn((url: string) => {
    const body = bodies[url];
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve(
      body
        ? new Response(new Uint8Array(body))
        : new Response(null, { status: 404 }),
    );
  });

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-speaker-models-"));
    bodies = {
      [MODELS.segmentation.urls[0]]: segmentation,
      [EMBEDDING]: embedding,
      [MIRROR]: embedding,
    };
    fetch.mockClear();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("pins every model by size, SHA-256 and URLs that cannot change", () => {
    for (const model of Object.values(SPEAKER_MODELS) as SpeakerModel[]) {
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(0);
      expect(model.urls.length).toBeGreaterThan(0);
      // A release asset can be re-uploaded under the same URL (sherpa-onnx's
      // CAM++ was, one byte longer); a commit's file cannot.
      for (const url of model.urls)
        expect(url).toMatch(
          /^https:\/\/[^/]+\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//,
        );
    }
  });

  it("downloads, checks and installs both models, reporting progress", async () => {
    const progress: number[] = [];
    const paths = await ensureSpeakerModels({
      directory,
      fetch,
      models: MODELS,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(await readFile(paths.segmentation)).toEqual(segmentation);
    expect(await readFile(paths.embedding)).toEqual(embedding);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    // No staging leftovers.
    expect((await readdir(directory)).sort()).toEqual([
      "embedding.onnx",
      "segmentation.onnx",
    ]);

    // Already there: nothing is fetched again.
    fetch.mockClear();
    await ensureSpeakerModels({ directory, fetch, models: MODELS });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a source whose file was replaced, and says so", async () => {
    // What happened upstream: the same URL, one byte more.
    const replaced = Buffer.concat([embedding, Buffer.from("!")]);
    bodies[EMBEDDING] = replaced;
    bodies[MIRROR] = replaced;
    const error = await failure(
      ensureSpeakerModels({ directory, fetch, models: MODELS }),
    );
    expect(error.reason).toBe("size");
    expect(await readySpeakerModels(directory, MODELS)).toBeUndefined();
    expect(await readdir(directory)).not.toContain("embedding.onnx");
  });

  it("refuses a download of the right size with the wrong bytes", async () => {
    const tampered = Buffer.from("embedding weights, a little LONGER");
    bodies[EMBEDDING] = tampered;
    bodies[MIRROR] = tampered;
    const error = await failure(
      ensureSpeakerModels({ directory, fetch, models: MODELS }),
    );
    expect(error.reason).toBe("checksum");
    expect(await readdir(directory)).not.toContain("embedding.onnx");
  });

  it("falls back to the mirror, with progress that does not overcount", async () => {
    bodies[EMBEDDING] = Buffer.concat([embedding, embedding]);
    const progress: number[] = [];
    const paths = await ensureSpeakerModels({
      directory,
      fetch,
      models: MODELS,
      onProgress: (fraction) => progress.push(fraction),
    });
    expect(await readFile(paths.embedding)).toEqual(embedding);
    expect(fetch).toHaveBeenCalledWith(MIRROR);
    expect(progress.at(-1)).toBe(1);
    // The refused attempt's bytes were taken back before the mirror's.
    const total = segmentation.length + embedding.length;
    expect(progress).toContain(segmentation.length / total);
  });

  it("reports a network failure when no source can be reached", async () => {
    bodies[EMBEDDING] = new TypeError("net::ERR_CONNECTION_RESET");
    delete bodies[MIRROR];
    const error = await failure(
      ensureSpeakerModels({ directory, fetch, models: MODELS }),
    );
    expect(error.reason).toBe("network");
    expect(error.message).toMatch(/HTTP 404/);
  });

  it("reports a disk failure without trying the other sources", async () => {
    // A file where the folder should be.
    const blocked = path.join(directory, "blocked");
    await writeFile(blocked, "");
    const error = await failure(
      ensureSpeakerModels({ directory: blocked, fetch, models: MODELS }),
    );
    expect(error.reason).toBe("disk");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("replaces a damaged model", async () => {
    await ensureSpeakerModels({ directory, fetch, models: MODELS });
    await writeFile(path.join(directory, "embedding.onnx"), "tampered");
    fetch.mockClear();
    await ensureSpeakerModels({ directory, fetch, models: MODELS });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(EMBEDDING);
  });
});
