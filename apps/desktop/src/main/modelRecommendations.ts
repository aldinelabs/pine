import { z } from "zod";

const GIST_RAW_BASE =
  "https://gist.githubusercontent.com/kev1nweng/a9a2fd18d8fb238f4c9ecbe7d6a64643/raw";

/**
 * Recommendations grouped by model kind. Lives in its own file of the gist so
 * released versions, which parse the legacy file as a bare array, keep working.
 */
export const MODEL_RECOMMENDATIONS_URL = `${GIST_RAW_BASE}/pine-recommended-models.v2.json`;

/** Chat model IDs only, as a bare string array; read by every released version. */
export const LEGACY_MODEL_RECOMMENDATIONS_URL = `${GIST_RAW_BASE}/pine-recommended-models.json`;

export const MODEL_RECOMMENDATION_KINDS = ["chat", "image", "video"] as const;
export type ModelRecommendationKind =
  (typeof MODEL_RECOMMENDATION_KINDS)[number];
export type ModelRecommendations = Readonly<
  Record<ModelRecommendationKind, readonly string[]>
>;

const MAX_IDS_PER_KIND = 1_000;
const ModelIdSchema = z.string().trim().min(1).max(200);

const LegacyRecommendedModelIdsSchema = z
  .array(ModelIdSchema)
  .max(MAX_IDS_PER_KIND);

const RecommendationsDocumentSchema = z
  .object({ version: z.literal(2) })
  .catchall(z.unknown());

export const EMPTY_MODEL_RECOMMENDATIONS: ModelRecommendations = {
  chat: [],
  image: [],
  video: [],
};

/** Keeps the valid, unique IDs of one kind; anything else becomes an empty list. */
function parseKind(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    const parsed = ModelIdSchema.safeParse(entry);
    if (parsed.success) ids.add(parsed.data);
    if (ids.size >= MAX_IDS_PER_KIND) break;
  }
  return [...ids];
}

/**
 * Parses the v2 document. A document that is not a version-2 object throws;
 * malformed entries and kinds are dropped so one bad line cannot hide the rest.
 */
export function parseModelRecommendations(
  value: unknown,
): ModelRecommendations {
  const document = RecommendationsDocumentSchema.parse(value);
  return {
    chat: parseKind(document.chat),
    image: parseKind(document.image),
    video: parseKind(document.video),
  };
}

interface ModelRecommendationServiceOptions {
  fetch?: typeof fetch;
  legacyUrl?: string;
  now?: () => number;
  retryDelayMs?: number;
  timeoutMs?: number;
  ttlMs?: number;
  url?: string;
}

export class ModelRecommendationService {
  private readonly fetch: typeof fetch;
  private readonly legacyUrl: string;
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly url: string;
  private cached: ModelRecommendations = EMPTY_MODEL_RECOMMENDATIONS;
  private expiresAt = 0;
  private pending: Promise<ModelRecommendations> | undefined;

  constructor(options: ModelRecommendationServiceOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.legacyUrl = options.legacyUrl ?? LEGACY_MODEL_RECOMMENDATIONS_URL;
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
    this.url = options.url ?? MODEL_RECOMMENDATIONS_URL;
  }

  get(): Promise<ModelRecommendations> {
    if (this.now() < this.expiresAt) return Promise.resolve(this.cached);
    if (this.pending) return this.pending;

    this.pending = this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async refresh(): Promise<ModelRecommendations> {
    try {
      this.cached = parseModelRecommendations(await this.load(this.url));
      this.expiresAt = this.now() + this.ttlMs;
      return this.cached;
    } catch {
      // Fall through to the legacy chat-only list.
    }

    try {
      const chat = LegacyRecommendedModelIdsSchema.parse(
        await this.load(this.legacyUrl),
      );
      // Image and video lists stay as the last v2 load left them.
      this.cached = { ...this.cached, chat: [...new Set(chat)] };
      this.expiresAt = this.now() + this.ttlMs;
    } catch {
      // Keep the last successful lists.
      this.expiresAt = this.now() + this.retryDelayMs;
    }
    return this.cached;
  }

  private async load(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Recommendation API returned ${response.status}.`);
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timeout);
    }
  }
}
