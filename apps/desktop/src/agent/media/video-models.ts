import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PineVideoModelDescriptor } from "../../shared/models";

export const VIDEO_ENDPOINT = "https://openrouter.ai/api/v1/videos";
const caches = new Map<
  string,
  { models: PineVideoModelDescriptor[]; until: number }
>();
const pending = new Map<string, Promise<PineVideoModelDescriptor[]>>();

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVideoModels(value: unknown): PineVideoModelDescriptor[] {
  if (!record(value) || !Array.isArray(value.data))
    throw new Error("Invalid video model catalog.");
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const models = value.data.flatMap((item): PineVideoModelDescriptor[] => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.name !== "string"
    )
      return [];
    return [
      {
        id: item.id,
        name: item.name,
        providerId: "openrouter",
        providerName: "OpenRouter",
        supportedDurations: Array.isArray(item.supported_durations)
          ? item.supported_durations.filter(
              (n): n is number =>
                typeof n === "number" && Number.isInteger(n) && n > 0,
            )
          : [],
        supportedResolutions: strings(item.supported_resolutions),
        supportedAspectRatios: strings(item.supported_aspect_ratios),
        ...(Array.isArray(item.supported_sizes)
          ? { supportedSizes: strings(item.supported_sizes) }
          : {}),
        ...(Array.isArray(item.supported_frame_images)
          ? { supportedFrameImages: strings(item.supported_frame_images) }
          : {}),
        ...(typeof item.generate_audio === "boolean"
          ? { generatesAudio: item.generate_audio }
          : {}),
        ...(typeof item.seed === "boolean" ? { supportsSeed: item.seed } : {}),
        ...(record(item.upscale_factor) &&
        typeof item.upscale_factor.min === "number" &&
        typeof item.upscale_factor.max === "number"
          ? {
              upscaleFactor: {
                min: item.upscale_factor.min,
                max: item.upscale_factor.max,
              },
            }
          : {}),
        ...(Array.isArray(item.creativity)
          ? {
              creativity: item.creativity.filter(
                (n): n is number =>
                  typeof n === "number" && Number.isInteger(n),
              ),
            }
          : {}),
        allowedPassthroughParameters: strings(
          item.allowed_passthrough_parameters,
        ),
        ...(typeof item.description === "string"
          ? { description: item.description }
          : {}),
        ...(record(item.pricing_skus)
          ? {
              pricingSkus: Object.fromEntries(
                Object.entries(item.pricing_skus).filter(
                  (entry): entry is [string, string] =>
                    typeof entry[1] === "string",
                ),
              ),
            }
          : {}),
      },
    ];
  });
  if (!models.length) throw new Error("Empty video model catalog.");
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

/** Cached discovery stays in the agent process; no credentials reach the renderer. */
export async function videoModelDescriptors(
  agentDir: string,
  options: { force?: boolean } = {},
): Promise<PineVideoModelDescriptor[]> {
  const cached = caches.get(agentDir);
  if (!options.force && cached && cached.until > Date.now())
    return cached.models;
  const existing = pending.get(agentDir);
  if (existing) return existing;
  const load = async () => {
    const cachePath = path.join(agentDir, "video-models.json");
    let fallback = cached?.models ?? [];
    if (!fallback.length) {
      try {
        fallback = parseVideoModels(
          JSON.parse(await readFile(cachePath, "utf8")),
        );
      } catch {
        /* No valid disk cache yet. */
      }
    }
    try {
      const response = await fetch(`${VIDEO_ENDPOINT}/models`, {
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Could not load video models (HTTP ${response.status}).`,
        );
      }
      const raw: unknown = await response.json();
      const models = parseVideoModels(raw);
      caches.set(agentDir, { models, until: Date.now() + 3_600_000 });
      try {
        await mkdir(agentDir, { recursive: true });
        await writeFile(cachePath, JSON.stringify(raw), { mode: 0o600 });
      } catch {
        /* In-memory catalog remains usable. */
      }
      return models;
    } catch (error) {
      caches.set(agentDir, { models: fallback, until: Date.now() + 60_000 });
      if (options.force) throw error;
      return fallback;
    }
  };
  const promise = load();
  pending.set(agentDir, promise);
  try {
    return await promise;
  } finally {
    pending.delete(agentDir);
  }
}
