import type {
  ImageApi,
  ImageModel,
  MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { PineImageModelDescriptor } from "../../shared/models";

/** pi-ai currently exposes image generation through OpenRouter only. */
export const IMAGE_MODEL_PROVIDER_ID = "openrouter";
export const IMAGE_MODEL_PROVIDER_NAME = "OpenRouter";

/**
 * Image generation is a separate pi-ai surface from chat models. The default
 * is the flagship general-purpose model; the user's picker selection wins
 * whenever it is set.
 */
export const DEFAULT_IMAGE_MODEL_ID = "google/gemini-3-pro-image";

let cachedImagesModels: MutableModels | undefined;

/**
 * Pine's image-generation collection: pi-ai's built-in OpenRouter image
 * provider, which aggregates upstream image models behind one API. Credentials
 * are resolved by the caller and passed per request.
 */
export function pineImagesModels(): MutableModels {
  cachedImagesModels ??= builtinModels();
  return cachedImagesModels;
}

export function imageModel(modelId: string): ImageModel<ImageApi> | undefined {
  return pineImagesModels().getModelOfType(
    "image",
    IMAGE_MODEL_PROVIDER_ID,
    modelId,
  );
}

export function imageModelIds(): string[] {
  return pineImagesModels()
    .getModelsOfType("image", IMAGE_MODEL_PROVIDER_ID)
    .map((model) => model.id);
}

/** Model descriptors for Pine's UI, sorted by display name. */
export function imageModelDescriptors(): PineImageModelDescriptor[] {
  return pineImagesModels()
    .getModelsOfType("image", IMAGE_MODEL_PROVIDER_ID)
    .map((model) => ({
      acceptsImageInput: model.input.includes("image"),
      id: model.id,
      name: model.name,
      providerId: IMAGE_MODEL_PROVIDER_ID,
      providerName: IMAGE_MODEL_PROVIDER_NAME,
      returnsText: model.output.includes("text"),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
