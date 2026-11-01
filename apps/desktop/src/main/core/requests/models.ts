import {
  ADD_CUSTOM_MODEL_CHANNEL,
  CANCEL_PROVIDER_AUTH_CHANNEL,
  DELETE_CUSTOM_MODEL_CHANNEL,
  DELETE_CUSTOM_PROVIDER_CHANNEL,
  GET_MODEL_CATALOG_CHANNEL,
  LOGIN_PROVIDER_CHANNEL,
  LOGOUT_PROVIDER_CHANNEL,
  LOOKUP_MODEL_METADATA_CHANNEL,
  REFRESH_MODEL_CATALOG_CHANNEL,
  RESPOND_PROVIDER_AUTH_CHANNEL,
  SELECT_IMAGE_MODEL_CHANNEL,
  SELECT_VIDEO_MODEL_CHANNEL,
  SELECT_MODEL_CHANNEL,
  SELECT_UTILITY_MODEL_CHANNEL,
  UPDATE_CUSTOM_MODEL_CHANNEL,
  UPDATE_CUSTOM_PROVIDER_CHANNEL,
  type AddCustomModelRequest,
  type DeleteCustomModelRequest,
  type DeleteCustomProviderRequest,
  type LookupModelMetadataRequest,
  type PineModelCatalog,
  type PineModelMetadata,
  type ProviderLoginResult,
  type UpdateCustomModelRequest,
  type UpdateCustomProviderRequest,
} from "../../../shared/models";
import type { PineCore } from "../pineCore";
import {
  AddCustomModelRequestSchema,
  DeleteCustomModelRequestSchema,
  DeleteCustomProviderRequestSchema,
  LoginProviderRequestSchema,
  LookupModelMetadataRequestSchema,
  ProviderAuthLoginIdSchema,
  ProviderAuthResponseRequestSchema,
  ProviderIdSchema,
  SelectImageModelRequestSchema,
  SelectVideoModelRequestSchema,
  SelectModelRequestSchema,
  SelectUtilityModelRequestSchema,
  UpdateCustomModelRequestSchema,
  UpdateCustomProviderRequestSchema,
} from "../requestSchemas";

export function registerModelRequests(core: PineCore): void {
  /** Recommendations only name models the catalog actually offers. */
  async function withRecommendations(
    catalog: Promise<PineModelCatalog>,
  ): Promise<PineModelCatalog> {
    const [models, recommendedIds] = await Promise.all([
      catalog,
      core.modelRecommendations.get(),
    ]);
    const availableIds = new Set(models.models.map((model) => model.id));
    return {
      ...models,
      recommendedModelIds: recommendedIds.filter((id) => availableIds.has(id)),
    };
  }

  function requireLoginOwner(loginId: string, clientId: number): void {
    if (core.providerLoginOwners.get(loginId) !== clientId)
      throw new Error("Provider login does not belong to this window.");
  }

  core.handle(GET_MODEL_CATALOG_CHANNEL, (): Promise<PineModelCatalog> =>
    withRecommendations(core.runtimes.getModelCatalog()),
  );

  core.handle(REFRESH_MODEL_CATALOG_CHANNEL, (): Promise<PineModelCatalog> =>
    withRecommendations(core.runtimes.refreshModelCatalog()),
  );

  core.handle(
    LOOKUP_MODEL_METADATA_CHANNEL,
    async (_context, request: unknown): Promise<PineModelMetadata> =>
      core.modelMetadata.lookup(
        LookupModelMetadataRequestSchema.parse(
          request,
        ) satisfies LookupModelMetadataRequest,
      ),
  );

  core.handle(
    ADD_CUSTOM_MODEL_CHANNEL,
    async (_context, request: unknown): Promise<PineModelCatalog> =>
      core.runtimes.addCustomModel(
        AddCustomModelRequestSchema.parse(
          request,
        ) satisfies AddCustomModelRequest,
      ),
  );

  core.handle(
    UPDATE_CUSTOM_MODEL_CHANNEL,
    async (_context, request: unknown): Promise<PineModelCatalog> =>
      core.runtimes.updateCustomModel(
        UpdateCustomModelRequestSchema.parse(
          request,
        ) satisfies UpdateCustomModelRequest,
      ),
  );

  core.handle(
    DELETE_CUSTOM_MODEL_CHANNEL,
    async (_context, request: unknown): Promise<PineModelCatalog> =>
      core.runtimes.deleteCustomModel(
        DeleteCustomModelRequestSchema.parse(
          request,
        ) satisfies DeleteCustomModelRequest,
      ),
  );

  core.handle(
    UPDATE_CUSTOM_PROVIDER_CHANNEL,
    async (_context, request: unknown): Promise<PineModelCatalog> =>
      core.runtimes.updateCustomProvider(
        UpdateCustomProviderRequestSchema.parse(
          request,
        ) satisfies UpdateCustomProviderRequest,
      ),
  );

  core.handle(
    DELETE_CUSTOM_PROVIDER_CHANNEL,
    async (_context, request: unknown): Promise<PineModelCatalog> =>
      core.runtimes.deleteCustomProvider(
        DeleteCustomProviderRequestSchema.parse(
          request,
        ) satisfies DeleteCustomProviderRequest,
      ),
  );

  core.handle(
    LOGIN_PROVIDER_CHANNEL,
    async (context, request: unknown): Promise<ProviderLoginResult> => {
      const parsed = LoginProviderRequestSchema.parse(request);
      core.providerLoginOwners.set(parsed.loginId, context.clientId);
      try {
        return await core.runtimes.loginProvider(parsed);
      } finally {
        core.providerLoginOwners.delete(parsed.loginId);
      }
    },
  );

  core.handle(
    RESPOND_PROVIDER_AUTH_CHANNEL,
    (context, request: unknown): Promise<{ accepted: boolean }> => {
      const parsed = ProviderAuthResponseRequestSchema.parse(request);
      requireLoginOwner(parsed.loginId, context.clientId);
      return core.runtimes.respondToProviderAuth(
        parsed.loginId,
        parsed.promptId,
        parsed.value,
      );
    },
  );

  core.handle(
    CANCEL_PROVIDER_AUTH_CHANNEL,
    (context, request: unknown): Promise<{ cancelled: boolean }> => {
      const { loginId } = ProviderAuthLoginIdSchema.parse(request);
      requireLoginOwner(loginId, context.clientId);
      return core.runtimes.cancelProviderAuth(loginId);
    },
  );

  core.handle(
    LOGOUT_PROVIDER_CHANNEL,
    (_context, request: unknown): Promise<{ disposed: boolean }> =>
      core.runtimes.logoutProvider(ProviderIdSchema.parse(request).providerId),
  );

  core.handle(
    SELECT_MODEL_CHANNEL,
    (context, request: unknown): Promise<{ disposed: boolean }> =>
      core.runtimes.selectModel(
        context.clientId,
        SelectModelRequestSchema.parse(request),
      ),
  );

  core.handle(
    SELECT_UTILITY_MODEL_CHANNEL,
    (_context, request: unknown): Promise<{ updated: boolean }> =>
      core.runtimes.selectUtilityModel(
        SelectUtilityModelRequestSchema.parse(request),
      ),
  );

  core.handle(
    SELECT_IMAGE_MODEL_CHANNEL,
    (_context, request: unknown): Promise<{ updated: boolean }> =>
      core.runtimes.selectImageModel(
        SelectImageModelRequestSchema.parse(request),
      ),
  );
  core.handle(
    SELECT_VIDEO_MODEL_CHANNEL,
    (_context, request: unknown): Promise<{ updated: boolean }> =>
      core.runtimes.selectVideoModel(
        SelectVideoModelRequestSchema.parse(request),
      ),
  );
}
