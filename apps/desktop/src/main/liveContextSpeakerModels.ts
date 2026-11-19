import { statSync } from "node:fs";
import { rm, rmdir } from "node:fs/promises";
import path from "node:path";
import pins from "../../native/live-context/speaker-models.json";

/**
 * The speaker-label models (pyannote segmentation-3.0, MIT; 3D-Speaker
 * CAM++, Apache-2.0) ship inside the macOS app: scripts/build-native.mjs
 * fetches them at build time, pinned by size and SHA-256, into
 * `native/live-context/build/live-context-models`, which packaging copies
 * to Resources. Nothing is downloaded at runtime.
 */
export interface SpeakerModel {
  /** Name in the models folder. */
  file: string;
  bytes: number;
}

export const SPEAKER_MODELS: Record<
  "segmentation" | "embedding",
  SpeakerModel
> = {
  segmentation: pins.segmentation,
  embedding: pins.embedding,
};

/** The models' folder, in Resources and in the native build folder. */
export const SPEAKER_MODELS_FOLDER = "live-context-models";

export type SpeakerModelPaths = Record<keyof typeof SPEAKER_MODELS, string>;

/**
 * The bundled models' paths when both are there at their pinned size (the
 * build checked their hashes); otherwise speaker labels are unavailable.
 */
export function bundledSpeakerModels(
  directory: string,
  models: Record<keyof typeof SPEAKER_MODELS, SpeakerModel> = SPEAKER_MODELS,
): SpeakerModelPaths | undefined {
  const paths = {
    segmentation: path.join(directory, models.segmentation.file),
    embedding: path.join(directory, models.embedding.file),
  };
  const present = (file: string, model: SpeakerModel) => {
    try {
      return statSync(file).size === model.bytes;
    } catch {
      return false;
    }
  };
  return present(paths.segmentation, models.segmentation) &&
    present(paths.embedding, models.embedding)
    ? paths
    : undefined;
}

/**
 * Earlier versions downloaded the models into `<userData>/models/
 * live-context-speakers` on first use; that copy is no longer read.
 * Best effort: a failure leaves it for the next start.
 */
export async function removeDownloadedSpeakerModels(
  userData: string,
): Promise<void> {
  const models = path.join(userData, "models");
  try {
    await rm(path.join(models, "live-context-speakers"), {
      recursive: true,
      force: true,
    });
    // Only if nothing else lives there.
    await rmdir(models).catch(() => undefined);
  } catch (error) {
    console.warn("Could not remove the old speaker models.", error);
  }
}
