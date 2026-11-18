import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureSpeakerModels,
  readySpeakerModels,
  SPEAKER_MODELS,
  type SpeakerModel,
} from "../liveContextSpeakerModels";

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

const segmentation = Buffer.from("segmentation weights");
const archive = Buffer.from("pretend tar.bz2");
const embedding = Buffer.from("embedding weights, a little longer");

const MODELS: Record<keyof typeof SPEAKER_MODELS, SpeakerModel> = {
  segmentation: {
    file: "segmentation.onnx",
    url: "https://example.test/segmentation.tar.bz2",
    sha256: sha256(segmentation),
    bytes: segmentation.length,
    archive: {
      sha256: sha256(archive),
      bytes: archive.length,
      member: "dir/model.onnx",
    },
  },
  embedding: {
    file: "embedding.onnx",
    url: "https://example.test/embedding.onnx",
    sha256: sha256(embedding),
    bytes: embedding.length,
  },
};

describe("speaker models", () => {
  let directory: string;
  let bodies: Record<string, Buffer>;
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      bodies[url]
        ? new Response(new Uint8Array(bodies[url]))
        : new Response(null, { status: 404 }),
    ),
  );
  const extract = vi.fn(
    async (from: string, member: string, destination: string) => {
      expect(await readFile(from)).toEqual(archive);
      expect(member).toBe("dir/model.onnx");
      await writeFile(destination, segmentation);
    },
  );

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-speaker-models-"));
    bodies = {
      [MODELS.segmentation.url]: archive,
      [MODELS.embedding.url]: embedding,
    };
    fetch.mockClear();
    extract.mockClear();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("pins every model by URL, size and SHA-256", () => {
    for (const model of Object.values(SPEAKER_MODELS) as SpeakerModel[]) {
      expect(model.url).toMatch(
        /^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\//,
      );
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.bytes).toBeGreaterThan(0);
    }
  });

  it("downloads, checks and installs both models, reporting progress", async () => {
    const progress: number[] = [];
    const paths = await ensureSpeakerModels({
      directory,
      fetch,
      extract,
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
    await ensureSpeakerModels({ directory, fetch, extract, models: MODELS });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a download that does not match its pin", async () => {
    bodies[MODELS.embedding.url] = Buffer.from(
      "embedding weights, a little LONGER",
    );
    await expect(
      ensureSpeakerModels({ directory, fetch, extract, models: MODELS }),
    ).rejects.toThrow(/checksum/);
    expect(await readySpeakerModels(directory, MODELS)).toBeUndefined();
    expect(await readdir(directory)).not.toContain("embedding.onnx");
  });

  it("stops reading a download that is larger than pinned", async () => {
    bodies[MODELS.embedding.url] = Buffer.concat([embedding, embedding]);
    await expect(
      ensureSpeakerModels({ directory, fetch, extract, models: MODELS }),
    ).rejects.toThrow(/larger/);
  });

  it("replaces a damaged model", async () => {
    await ensureSpeakerModels({ directory, fetch, extract, models: MODELS });
    await writeFile(path.join(directory, "embedding.onnx"), "tampered");
    fetch.mockClear();
    await ensureSpeakerModels({ directory, fetch, extract, models: MODELS });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(MODELS.embedding.url);
  });

  it("fails on an HTTP error", async () => {
    delete bodies[MODELS.segmentation.url];
    await expect(
      ensureSpeakerModels({ directory, fetch, extract, models: MODELS }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
