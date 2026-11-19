import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pins from "../../../native/live-context/speaker-models.json";
import {
  bundledSpeakerModels,
  removeDownloadedSpeakerModels,
  SPEAKER_MODELS,
  type SpeakerModel,
} from "../liveContextSpeakerModels";

const MODELS: Record<keyof typeof SPEAKER_MODELS, SpeakerModel> = {
  segmentation: { file: "segmentation.onnx", bytes: 4 },
  embedding: { file: "embedding.onnx", bytes: 6 },
};

describe("speaker models", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-speaker-models-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("pins every model by size, SHA-256 and URLs that cannot change", () => {
    for (const model of [pins.segmentation, pins.embedding]) {
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
    expect(SPEAKER_MODELS.embedding.file).toBe(pins.embedding.file);
  });

  it("finds the bundled models when both are there at their pinned size", async () => {
    await writeFile(path.join(directory, "segmentation.onnx"), "abcd");
    await writeFile(path.join(directory, "embedding.onnx"), "abcdef");
    expect(bundledSpeakerModels(directory, MODELS)).toEqual({
      segmentation: path.join(directory, "segmentation.onnx"),
      embedding: path.join(directory, "embedding.onnx"),
    });
  });

  it("has none when one is missing or cut short", async () => {
    await writeFile(path.join(directory, "segmentation.onnx"), "abcd");
    expect(bundledSpeakerModels(directory, MODELS)).toBeUndefined();
    await writeFile(path.join(directory, "embedding.onnx"), "abc");
    expect(bundledSpeakerModels(directory, MODELS)).toBeUndefined();
    expect(
      bundledSpeakerModels(path.join(directory, "absent"), MODELS),
    ).toBeUndefined();
  });

  it("removes models an earlier version downloaded, and nothing else", async () => {
    const old = path.join(directory, "models", "live-context-speakers");
    await mkdir(old, { recursive: true });
    await writeFile(path.join(old, "embedding.onnx"), "old");
    await removeDownloadedSpeakerModels(directory);
    expect(existsSync(path.join(directory, "models"))).toBe(false);

    // Other models stay, and so does their folder.
    const other = path.join(directory, "models", "other");
    await mkdir(old, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(path.join(other, "keep.bin"), "keep");
    await removeDownloadedSpeakerModels(directory);
    expect(existsSync(old)).toBe(false);
    expect(await readFile(path.join(other, "keep.bin"), "utf8")).toBe("keep");

    // Nothing to remove is fine.
    await expect(
      removeDownloadedSpeakerModels(path.join(directory, "absent")),
    ).resolves.toBeUndefined();
  });
});
