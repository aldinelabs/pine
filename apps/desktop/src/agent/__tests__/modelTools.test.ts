import { describe, expect, it } from "vitest";
import type { PineModelCatalog } from "../../shared/models";
import { listUsableModels } from "../modelTools";

function model(providerId: string, id: string) {
  return {
    api: "openai-completions",
    contextWindow: 200_000,
    id,
    input: ["text"] as const,
    maxTokens: 32_000,
    name: id.toUpperCase(),
    providerId,
    providerName: providerId,
    reasoning: true,
    supportedThinkingLevels: ["off", "high"] as const,
  };
}

const catalog: PineModelCatalog = {
  providers: [
    {
      id: "ready",
      name: "Ready",
      configured: true,
      authMethods: [],
      modelCount: 1,
    },
    {
      id: "absent",
      name: "Absent",
      configured: false,
      authMethods: [],
      modelCount: 1,
    },
  ],
  models: [model("ready", "a"), model("absent", "b")],
  selection: { providerId: "ready", modelId: "a", thinkingLevel: "off" },
};

describe("listUsableModels", () => {
  it("lists configured providers' models with the current and default model", () => {
    const result = listUsableModels(catalog, {
      providerId: "ready",
      modelId: "a",
      thinkingLevel: "high",
    });
    expect(result.current).toEqual({
      providerId: "ready",
      modelId: "a",
      thinkingLevel: "high",
      name: "A",
    });
    expect(result.userDefault).toMatchObject({ thinkingLevel: "off" });
    expect(result.models.map((entry) => entry.modelId)).toEqual(["a"]);
    expect(result.models[0]).toMatchObject({
      contextWindow: 200_000,
      thinkingLevels: ["off", "high"],
    });
  });
});
