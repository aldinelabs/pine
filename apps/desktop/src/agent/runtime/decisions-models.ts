import type { PineDecisionsModelDescriptor } from "../../shared/models";

/**
 * Decisions models have no pi-ai collection yet. Keep this catalog separate
 * from chat models and include only IDs supported by the Decisions endpoint.
 * https://openrouter.ai/docs/guides/community/jev-tutorial
 */
const MODELS: readonly PineDecisionsModelDescriptor[] = [
  {
    id: "typesafe/jev-1.13",
    name: "Jev 1.13",
    providerId: "openrouter",
    providerName: "OpenRouter",
  },
  {
    id: "~typesafe/jev-latest",
    name: "Jev (latest)",
    providerId: "openrouter",
    providerName: "OpenRouter",
  },
];

export function decisionsModelDescriptors(): PineDecisionsModelDescriptor[] {
  return MODELS.map((model) => ({ ...model }));
}

export function isDecisionsModelId(modelId: string): boolean {
  return MODELS.some((model) => model.id === modelId);
}
