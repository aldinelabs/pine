import { describe, expect, it, vi } from "vitest";
import type { PineCore } from "../../pineCore";
import {
  GET_MODEL_CATALOG_CHANNEL,
  type PineModelCatalog,
} from "../../../../shared/models";
import type { ModelRecommendations } from "../../../modelRecommendations";
import { registerModelRequests } from "../models";

type Handler = (context: unknown, request?: unknown) => Promise<unknown>;

const catalog: PineModelCatalog = {
  models: [
    {
      api: "test",
      contextWindow: 128_000,
      id: "glm-5.3-flash",
      input: ["text"],
      maxTokens: 8_192,
      name: "GLM 5.3 Flash",
      providerId: "zai",
      providerName: "Z.AI",
      reasoning: false,
      supportedThinkingLevels: ["off"],
    },
  ],
  providers: [],
  imageModels: [
    {
      acceptsImageInput: true,
      id: "google/gemini-3-pro-image",
      name: "Nano Banana Pro",
      providerId: "openrouter",
      providerName: "OpenRouter",
      returnsText: true,
    },
  ],
  videoModels: [],
};

describe("registerModelRequests", () => {
  it("adds each kind's recommendations, limited to models the catalog offers", async () => {
    const handlers = new Map<string, Handler>();
    const recommendations: ModelRecommendations = {
      chat: ["missing-chat", "glm-5.3-flash"],
      image: ["google/gemini-3-pro-image", "glm-5.3-flash"],
      video: ["vendor/video-a"],
    };
    const core = {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      modelRecommendations: {
        get: vi.fn().mockResolvedValue(recommendations),
      },
      runtimes: {
        getModelCatalog: vi.fn().mockResolvedValue(catalog),
      },
    } as unknown as PineCore;

    registerModelRequests(core);
    const result = (await handlers.get(GET_MODEL_CATALOG_CHANNEL)?.(
      {},
    )) as PineModelCatalog;

    expect(result.recommendedModelIds).toEqual(["glm-5.3-flash"]);
    expect(result.recommendedImageModelIds).toEqual([
      "google/gemini-3-pro-image",
    ]);
    expect(result.recommendedVideoModelIds).toEqual([]);
  });
});
