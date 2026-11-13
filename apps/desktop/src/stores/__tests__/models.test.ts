import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { effect } from "vue";
import type { PineModelCatalog, PineModelDescriptor } from "@/shared/models";
import {
  MODEL_FAVORITES_STORAGE_KEY,
  MODEL_RECENTS_STORAGE_KEY,
  defaultThinkingLevel,
  pineModelKey,
  useModelsStore,
} from "../models";

const alpha: PineModelDescriptor = {
  api: "test",
  contextWindow: 128_000,
  id: "alpha",
  input: ["text"],
  maxTokens: 8_192,
  name: "Alpha",
  providerId: "provider",
  providerName: "Provider",
  reasoning: true,
  supportedThinkingLevels: ["off", "high"],
};

const beta: PineModelDescriptor = {
  ...alpha,
  id: "beta",
  name: "Beta",
};

const catalog: PineModelCatalog = {
  models: [alpha, beta],
  providers: [
    {
      authMethods: [{ label: "API key", type: "api_key" }],
      configured: true,
      id: "provider",
      modelCount: 2,
      name: "Provider",
    },
  ],
  recommendedModelIds: ["alpha", "ALPHA"],
};

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getModelCatalog: vi.fn().mockResolvedValue(catalog),
      logoutProvider: vi.fn().mockResolvedValue({ disposed: true }),
      selectImageModel: vi.fn().mockResolvedValue({ updated: true }),
      selectModel: vi.fn().mockResolvedValue(undefined),
      selectUtilityModel: vi.fn().mockResolvedValue({ updated: true }),
      selectApprovalModel: vi.fn().mockResolvedValue({ updated: true }),
    },
  });
});

describe("models store lists", () => {
  it("matches recommended models by exact model ID", () => {
    const store = useModelsStore();
    store.catalog = catalog;

    expect(store.isRecommended(alpha)).toBe(true);
    expect(store.isRecommended(beta)).toBe(false);
  });

  it("shows recent models until the user has favorites", async () => {
    const store = useModelsStore();
    store.catalog = catalog;

    await store.select(alpha);
    await store.select(beta);

    expect(store.recentModels).toEqual([beta, alpha]);
    expect(store.featuredModels).toEqual([beta, alpha]);
    expect(
      JSON.parse(localStorage.getItem(MODEL_RECENTS_STORAGE_KEY) ?? "[]"),
    ).toEqual([pineModelKey(beta), pineModelKey(alpha)]);

    store.toggleFavorite(alpha);

    expect(store.favoriteModels).toEqual([alpha]);
    expect(store.featuredModels).toEqual([alpha]);
    expect(
      JSON.parse(localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY) ?? "[]"),
    ).toEqual([pineModelKey(alpha)]);
  });

  it("targets model changes to one conversation without changing defaults", async () => {
    const store = useModelsStore();
    store.catalog = {
      ...catalog,
      selection: {
        providerId: alpha.providerId,
        modelId: alpha.id,
        thinkingLevel: "high",
      },
    };

    await store.select(beta, "off", "019cfe51-7166-79b9-a5b9-c652fcca9eab");

    expect(window.pine.selectModel).toHaveBeenCalledWith({
      providerId: beta.providerId,
      modelId: beta.id,
      sessionId: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
      thinkingLevel: "off",
    });
    expect(store.selection).toEqual({
      providerId: alpha.providerId,
      modelId: alpha.id,
      thinkingLevel: "high",
    });
    expect(store.selectionFor("019cfe51-7166-79b9-a5b9-c652fcca9eab")).toEqual({
      providerId: beta.providerId,
      modelId: beta.id,
      thinkingLevel: "off",
    });
  });

  it("restores favorites from Pine local storage", () => {
    localStorage.setItem(
      MODEL_FAVORITES_STORAGE_KEY,
      JSON.stringify([pineModelKey(beta)]),
    );
    const store = useModelsStore();
    store.catalog = catalog;

    expect(store.favoriteModels).toEqual([beta]);

    store.toggleFavorite(beta);

    expect(store.favoriteModels).toEqual([]);
  });

  it("creates a stable snapshot of favorite model keys", () => {
    const store = useModelsStore();
    store.catalog = catalog;
    store.toggleFavorite(alpha);
    const snapshot = store.favoriteModelKeysSnapshot();

    store.toggleFavorite(alpha);
    store.toggleFavorite(beta);

    expect(snapshot).toEqual([pineModelKey(alpha)]);
    expect(store.favoriteModelKeysSnapshot()).toEqual([pineModelKey(beta)]);
  });

  it("deletes provider credentials through the preload API and reloads", async () => {
    const store = useModelsStore();
    store.catalog = catalog;

    await store.logout("provider");

    expect(window.pine.logoutProvider).toHaveBeenCalledWith({
      providerId: "provider",
    });
    expect(window.pine.getModelCatalog).toHaveBeenCalledOnce();
  });

  it("keeps the published catalog when a reload returns the same payload", async () => {
    const store = useModelsStore();
    const published = { ...catalog, models: [...catalog.models] };
    store.catalog = published;

    await store.load();

    expect(store.catalog).toBe(published);
  });

  it("publishes a catalog whose payload changed", async () => {
    const store = useModelsStore();
    const published = { ...catalog, models: [alpha] };
    store.catalog = published;

    await store.load();

    expect(store.catalog).not.toBe(published);
    expect(store.catalog.models).toEqual(catalog.models);
  });

  it("selects a dedicated utility model without changing the session model", async () => {
    const store = useModelsStore();
    store.catalog = {
      ...catalog,
      selection: {
        providerId: alpha.providerId,
        modelId: alpha.id,
        thinkingLevel: "high",
      },
    };

    await store.selectUtilityModel(beta);

    expect(window.pine.selectUtilityModel).toHaveBeenCalledWith({
      providerId: beta.providerId,
      modelId: beta.id,
    });
    expect(store.selectedModel).toBe(alpha);
    expect(store.utilitySelectedModel).toBe(beta);
  });

  it("selects the approval model independently from the utility model", async () => {
    const store = useModelsStore();
    store.catalog = {
      ...catalog,
      utilitySelection: { providerId: alpha.providerId, modelId: alpha.id },
    };

    await store.selectApprovalModel(beta);

    expect(window.pine.selectApprovalModel).toHaveBeenCalledWith({
      providerId: beta.providerId,
      modelId: beta.id,
    });
    expect(store.approvalSelectedModel).toBe(beta);
    expect(store.utilitySelectedModel).toBe(alpha);
  });

  it("selects an image model without changing the chat model", async () => {
    const store = useModelsStore();
    const imageModel = {
      acceptsImageInput: true,
      id: "google/gemini-3-pro-image",
      name: "Google: Nano Banana Pro",
      providerId: "openrouter",
      providerName: "OpenRouter",
      returnsText: true,
    };
    store.catalog = {
      ...catalog,
      imageModels: [imageModel],
      selection: {
        providerId: alpha.providerId,
        modelId: alpha.id,
        thinkingLevel: "high",
      },
    };

    await store.selectImageModel(imageModel);

    expect(window.pine.selectImageModel).toHaveBeenCalledWith({
      providerId: imageModel.providerId,
      modelId: imageModel.id,
    });
    expect(store.selectedModel).toBe(alpha);
    expect(store.imageSelectedModel).toBe(imageModel);
    expect(store.imageSelection).toEqual({
      providerId: imageModel.providerId,
      modelId: imageModel.id,
    });
  });
});

describe("defaultThinkingLevel", () => {
  it.each([
    [["off", "high", "medium"], "medium"],
    [["off", "low", "high"], "high"],
    [["off", "low", "xhigh"], "low"],
    [["off", "max", "xhigh"], "xhigh"],
    [["off", "max"], "max"],
    [["off", "minimal"], "off"],
    [["off"], "off"],
  ] as const)("chooses %s as %s", (supported, expected) => {
    expect(defaultThinkingLevel(supported)).toBe(expected);
  });
});

describe("session model selections", () => {
  it("leaves the selections alone when nothing changes", () => {
    const store = useModelsStore();
    const selection = {
      providerId: "provider",
      modelId: "alpha",
      thinkingLevel: "high" as const,
    };
    let runs = 0;
    effect(() => {
      store.selectionFor("session");
      runs += 1;
    });

    store.setSessionSelection("session", selection);
    expect(runs).toBe(2);
    store.setSessionSelection("session", { ...selection });
    store.setSessionSelection("other", undefined);
    expect(runs).toBe(2);
    expect(store.selectionFor("session")).toEqual(selection);

    store.setSessionSelection("session", { ...selection, modelId: "beta" });
    expect(runs).toBe(3);
    expect(store.selectionFor("session")?.modelId).toBe("beta");
    store.setSessionSelection("session", undefined);
    expect(runs).toBe(4);
    expect(store.selectionFor("session")).toBeUndefined();
  });
});
