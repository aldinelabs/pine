export const GET_MODEL_CATALOG_CHANNEL = "models:catalog" as const;
export const REFRESH_MODEL_CATALOG_CHANNEL = "models:refresh-catalog" as const;
export const ADD_CUSTOM_MODEL_CHANNEL = "models:add-custom" as const;
export const UPDATE_CUSTOM_MODEL_CHANNEL = "models:update-custom" as const;
export const DELETE_CUSTOM_MODEL_CHANNEL = "models:delete-custom" as const;
export const UPDATE_CUSTOM_PROVIDER_CHANNEL =
  "providers:update-custom" as const;
export const DELETE_CUSTOM_PROVIDER_CHANNEL =
  "providers:delete-custom" as const;
export const LOOKUP_MODEL_METADATA_CHANNEL = "models:lookup-metadata" as const;
export const SELECT_MODEL_CHANNEL = "models:select" as const;
export const SELECT_UTILITY_MODEL_CHANNEL = "models:select-utility" as const;
export const SELECT_IMAGE_MODEL_CHANNEL = "models:select-image" as const;
export const LOGIN_PROVIDER_CHANNEL = "providers:login" as const;
export const RESPOND_PROVIDER_AUTH_CHANNEL = "providers:auth-response" as const;
export const CANCEL_PROVIDER_AUTH_CHANNEL = "providers:auth-cancel" as const;
export const LOGOUT_PROVIDER_CHANNEL = "providers:logout" as const;
export const OPEN_PROVIDER_AUTH_URL_CHANNEL =
  "providers:open-auth-url" as const;
export const PROVIDER_AUTH_EVENT_CHANNEL = "providers:auth-event" as const;

export type PineAuthType = "api_key" | "oauth";
export type PineCustomModelApi =
  | "anthropic-messages"
  | "google-generative-ai"
  | "openai-completions"
  | "openai-responses";
export type PineThinkingLevel =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface PineProviderAuthMethod {
  label: string;
  type: PineAuthType;
}

export interface PineModelDescriptor {
  api: string;
  contextWindow: number;
  id: string;
  input: readonly ("image" | "text")[];
  maxTokens: number;
  name: string;
  providerId: string;
  providerName: string;
  reasoning: boolean;
  supportedThinkingLevels: readonly PineThinkingLevel[];
  isCustom?: boolean;
}

export interface PineProviderDescriptor {
  authMethods: readonly PineProviderAuthMethod[];
  authSource?: string;
  configured: boolean;
  id: string;
  isCustom?: boolean;
  modelCount: number;
  name: string;
  api?: PineCustomModelApi;
  baseUrl?: string;
  hasApiKey?: boolean;
}

export interface PineModelSelection {
  modelId: string;
  providerId: string;
  thinkingLevel: PineThinkingLevel;
}

export type PineUtilityModelSelection = Pick<
  PineModelSelection,
  "modelId" | "providerId"
>;

/**
 * An image-generation model from pi-ai's image catalog. Image models live in
 * their own collection rather than in the chat model list, so they are
 * described separately and never appear in the chat model picker.
 */
export interface PineImageModelDescriptor {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  /** The model can take reference images as additional input. */
  acceptsImageInput: boolean;
  /** The model answers with text besides images. */
  returnsText: boolean;
}

export type PineImageModelSelection = Pick<
  PineModelSelection,
  "modelId" | "providerId"
>;

/** A typed decision model, separate from chat and image generation models. */
export interface PineDecisionsModelDescriptor {
  id: string;
  name: string;
  providerId: "openrouter";
  providerName: string;
}

export interface PineModelCatalog {
  decisionsModels?: readonly PineDecisionsModelDescriptor[];
  imageModels?: readonly PineImageModelDescriptor[];
  imageSelection?: PineImageModelSelection;
  models: readonly PineModelDescriptor[];
  providers: readonly PineProviderDescriptor[];
  recommendedModelIds?: readonly string[];
  selection?: PineModelSelection;
  utilitySelection?: PineUtilityModelSelection;
}

export interface CustomModelDefinition {
  contextWindow: number;
  maxTokens: number;
  modelId: string;
  modelName?: string;
  thinkingLevels: readonly PineThinkingLevel[];
  vision: boolean;
}

export type AddCustomModelRequest = CustomModelDefinition &
  (
    | {
        api: PineCustomModelApi;
        apiKey: string;
        baseUrl: string;
        providerId: string;
        providerMode: "new";
        providerName: string;
      }
    | {
        providerId: string;
        providerMode: "existing";
      }
  );

export type UpdateCustomModelRequest = CustomModelDefinition & {
  originalModelId: string;
  providerId: string;
};

export interface UpdateCustomProviderRequest {
  api: PineCustomModelApi;
  apiKey?: string;
  baseUrl: string;
  providerId: string;
  providerName: string;
}

export interface DeleteCustomModelRequest {
  modelId: string;
  providerId: string;
}

export interface DeleteCustomProviderRequest {
  providerId: string;
}

export interface LookupModelMetadataRequest {
  modelId: string;
  providerId?: string;
}

export interface PineModelMetadata {
  contextWindow?: number;
  maxTokens?: number;
  modelName: string;
  sourceId: string;
  thinkingLevels: readonly PineThinkingLevel[];
  vision: boolean;
}

export type PineProviderAuthPrompt =
  | {
      type: "text" | "secret" | "manual_code";
      message: string;
      placeholder?: string;
    }
  | {
      type: "select";
      message: string;
      options: readonly {
        id: string;
        label: string;
        description?: string;
      }[];
    };

export type PineProviderAuthNotice =
  | {
      type: "info";
      message: string;
      links?: readonly { label?: string; url: string }[];
    }
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: "progress"; message: string };

export type PineProviderAuthEvent =
  | {
      type: "provider-auth-prompt";
      loginId: string;
      promptId: string;
      prompt: PineProviderAuthPrompt;
    }
  | {
      type: "provider-auth-notice";
      loginId: string;
      notice: PineProviderAuthNotice;
    };

export interface LoginProviderRequest {
  authType: PineAuthType;
  loginId: string;
  providerId: string;
}

export interface ProviderAuthResponseRequest {
  loginId: string;
  promptId: string;
  value: string;
}

export interface ProviderLoginResult {
  credentialType: PineAuthType;
}

export type SelectModelRequest = PineModelSelection & {
  /** The conversation whose persisted model should change. Omit for defaults. */
  sessionId?: string;
};
export type SelectUtilityModelRequest = PineUtilityModelSelection;
export type SelectImageModelRequest = PineImageModelSelection;

export interface LogoutProviderRequest {
  providerId: string;
}

export type ProviderAuthEventListener = (event: PineProviderAuthEvent) => void;

export function isProviderAuthEvent(
  value: unknown,
): value is PineProviderAuthEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as { type?: unknown };
  return (
    event.type === "provider-auth-prompt" ||
    event.type === "provider-auth-notice"
  );
}
