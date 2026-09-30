import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PineDecisionsModelDescriptor } from "../../shared/models";

const MODELS_ENDPOINT =
  "https://openrouter.ai/api/v1/models?output_modalities=decisions";
const CACHE_TTL_MS = 60 * 60 * 1_000;
const RETRY_DELAY_MS = 60 * 1_000;
const FETCH_TIMEOUT_MS = 5_000;

// Offline snapshot of OpenRouter's Decisions catalog, not a selection allowlist.
const SNAPSHOT: readonly PineDecisionsModelDescriptor[] = [
  ["typesafe/jev-1.13", "TypeSafe: Jev 1.13"],
  ["~typesafe/jev-latest", "TypeSafe: Jev Latest"],
  ["upstage/solar-decide", "Upstage: Solar Decide"],
  ["respan/span-01", "Respan: Span-01"],
  ["respan/span-01-lite", "Respan: Span-01 Lite"],
  ["respan/span-01-lite:free", "Respan: Span-01 Lite (free)"],
  ["jaredpalmer/kev-4b", "Jared Palmer: Kev 4B"],
].map(([id, name]) => ({
  id,
  name,
  providerId: "openrouter",
  providerName: "OpenRouter",
}));

interface CatalogCache {
  models: PineDecisionsModelDescriptor[];
  fetchedAt: number;
  retryAfter: number;
}

const caches = new Map<string, CatalogCache>();
const pending = new Map<string, Promise<PineDecisionsModelDescriptor[]>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModelText(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

/** Discover by output modality, never by author, model name, or chat capabilities. */
export function parseDecisionsModels(
  value: unknown,
): PineDecisionsModelDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.data))
    throw new Error("Invalid Decisions model catalog.");
  const models = new Map<string, PineDecisionsModelDescriptor>();
  for (const model of value.data) {
    if (
      !isRecord(model) ||
      !isModelText(model.id) ||
      !isModelText(model.name) ||
      !isRecord(model.architecture) ||
      !Array.isArray(model.architecture.output_modalities) ||
      !model.architecture.output_modalities.includes("decisions")
    )
      continue;
    models.set(model.id, {
      id: model.id,
      name: model.name,
      providerId: "openrouter",
      providerName: "OpenRouter",
    });
  }
  if (models.size === 0) throw new Error("Empty Decisions model catalog.");
  return [...models.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

async function readCache(agentDir: string): Promise<CatalogCache> {
  try {
    const value: unknown = JSON.parse(
      await readFile(path.join(agentDir, "decisions-models.json"), "utf8"),
    );
    if (
      isRecord(value) &&
      typeof value.fetchedAt === "number" &&
      Number.isFinite(value.fetchedAt) &&
      value.fetchedAt > 0 &&
      value.fetchedAt <= Date.now() &&
      Array.isArray(value.models)
    ) {
      const models = parseDecisionsModels({
        data: value.models.map((model) =>
          isRecord(model)
            ? {
                id: model.id,
                name: model.name,
                architecture: { output_modalities: ["decisions"] },
              }
            : null,
        ),
      });
      return { models, fetchedAt: value.fetchedAt, retryAfter: 0 };
    }
  } catch {
    // First launch, unreadable cache, or invalid cache: use the offline snapshot.
  }
  return {
    models: SNAPSHOT.map((model) => ({ ...model })),
    fetchedAt: 0,
    retryAfter: 0,
  };
}

async function loadCatalog(
  agentDir: string,
  force: boolean,
): Promise<PineDecisionsModelDescriptor[]> {
  const cache = caches.get(agentDir) ?? (await readCache(agentDir));
  caches.set(agentDir, cache);
  if (
    !force &&
    (Date.now() - cache.fetchedAt < CACHE_TTL_MS ||
      Date.now() < cache.retryAfter)
  )
    return cache.models;
  try {
    const response = await fetch(MODELS_ENDPOINT, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Could not refresh Decisions models: HTTP ${response.status}.`,
      );
    }
    const models = parseDecisionsModels(await response.json());
    const next = { models, fetchedAt: Date.now(), retryAfter: 0 };
    caches.set(agentDir, next);
    try {
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        path.join(agentDir, "decisions-models.json"),
        `${JSON.stringify({ models, fetchedAt: next.fetchedAt }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      // The current process can still use the freshly discovered models.
    }
    return models;
  } catch (error) {
    cache.retryAfter = Date.now() + RETRY_DELAY_MS;
    if (force) throw error;
    return cache.models;
  }
}

/** Cached discovery runs in the agent process; renderers only receive descriptors. */
export async function decisionsModelDescriptors(
  agentDir: string,
  options: { force?: boolean } = {},
): Promise<PineDecisionsModelDescriptor[]> {
  let inFlight = pending.get(agentDir);
  if (inFlight) {
    try {
      await inFlight;
    } catch (error) {
      if (options.force) throw error;
      return (caches.get(agentDir)?.models ?? SNAPSHOT).map((model) => ({
        ...model,
      }));
    }
    if (options.force) {
      if (pending.get(agentDir) === inFlight) pending.delete(agentDir);
      return decisionsModelDescriptors(agentDir, options);
    }
  } else {
    inFlight = loadCatalog(agentDir, options.force ?? false);
    pending.set(agentDir, inFlight);
  }
  try {
    return (await inFlight).map((model) => ({ ...model }));
  } finally {
    if (pending.get(agentDir) === inFlight) pending.delete(agentDir);
  }
}
