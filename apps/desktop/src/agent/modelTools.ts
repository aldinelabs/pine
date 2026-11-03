import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { UI_LIST_MODELS_TOOL_NAME } from "../shared/agent";
import type { PineModelCatalog, PineModelSelection } from "../shared/models";

export interface PineModelToolContext {
  /** The model and thinking level this conversation runs on now. */
  current(): PineModelSelection | undefined;
  catalog(): Promise<PineModelCatalog>;
}

/** Usable chat models: those whose provider is signed in or has a key. */
export function listUsableModels(
  catalog: PineModelCatalog,
  current: PineModelSelection | undefined,
) {
  const configured = new Set(
    catalog.providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.id),
  );
  const describe = (selection: PineModelSelection) => {
    const model = catalog.models.find(
      (candidate) =>
        candidate.providerId === selection.providerId &&
        candidate.id === selection.modelId,
    );
    return { ...selection, ...(model ? { name: model.name } : {}) };
  };
  return {
    ...(current ? { current: describe(current) } : {}),
    ...(catalog.selection ? { userDefault: describe(catalog.selection) } : {}),
    models: catalog.models
      .filter((model) => configured.has(model.providerId))
      .map((model) => ({
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input: model.input,
        reasoning: model.reasoning,
        thinkingLevels: model.supportedThinkingLevels,
      })),
  };
}

export function createModelToolDefinitions(
  context: PineModelToolContext,
): ToolDefinition[] {
  return [
    defineTool({
      name: UI_LIST_MODELS_TOOL_NAME,
      label: "List Models",
      description:
        "List the chat models the user can use, with provider, context window, output limit, input types and supported thinking levels, plus the model and thinking level this conversation runs on and the user's default. Read-only; it does not change the model.",
      parameters: Type.Object({}),
      execute: async () => {
        const result = listUsableModels(
          await context.catalog(),
          context.current(),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    }),
  ];
}
