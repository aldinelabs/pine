import type {
  ImageApi,
  ImageModel,
  MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { PineImageModelDescriptor } from "../../shared/models";
import {
  CHATGPT_IMAGE_PROVIDER_ID,
  CHATGPT_IMAGE_PROVIDER_NAME,
  chatGptImagesProvider,
} from "./codex-images";

/** The default image provider; ChatGPT is an opt-in second source. */
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
 * provider, which aggregates upstream image models behind one API, plus the
 * ChatGPT subscription provider registered through the same Pi interface.
 * Credentials are resolved by the caller and passed per request.
 */
export function pineImagesModels(): MutableModels {
  if (!cachedImagesModels) {
    cachedImagesModels = builtinModels();
    cachedImagesModels.setProvider(chatGptImagesProvider());
  }
  return cachedImagesModels;
}

export function imageModel(
  modelId: string,
  providerId: string = IMAGE_MODEL_PROVIDER_ID,
): ImageModel<ImageApi> | undefined {
  if (
    providerId !== IMAGE_MODEL_PROVIDER_ID &&
    providerId !== CHATGPT_IMAGE_PROVIDER_ID
  ) {
    return undefined;
  }
  return pineImagesModels().getModelOfType("image", providerId, modelId);
}

/** True when the image model runs on the user's ChatGPT plan. */
export function usesChatGptSubscription(model: { provider: string }): boolean {
  return model.provider === CHATGPT_IMAGE_PROVIDER_ID;
}

export function imageModelIds(): string[] {
  return pineImagesModels()
    .getModelsOfType("image", IMAGE_MODEL_PROVIDER_ID)
    .map((model) => model.id);
}

/**
 * Model descriptors for Pine's UI: OpenRouter models sorted by display name,
 * then the ChatGPT subscription entry, which stays unavailable until the user
 * signs in to OpenAI Codex.
 */
export function imageModelDescriptors(
  options: { chatGptSignedIn?: boolean } = {},
): PineImageModelDescriptor[] {
  const openRouter = pineImagesModels()
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
  const chatGpt = pineImagesModels()
    .getModelsOfType("image", CHATGPT_IMAGE_PROVIDER_ID)
    .map((model) => ({
      acceptsImageInput: model.input.includes("image"),
      available: options.chatGptSignedIn === true,
      id: model.id,
      name: model.name,
      providerId: CHATGPT_IMAGE_PROVIDER_ID,
      providerName: CHATGPT_IMAGE_PROVIDER_NAME,
      returnsText: false,
      usesSubscription: true,
    }));
  return [...openRouter, ...chatGpt];
}
