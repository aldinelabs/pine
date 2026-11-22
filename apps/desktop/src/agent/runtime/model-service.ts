import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  getSupportedThinkingLevels,
  type Api,
  type AuthPrompt,
  type Model,
} from "@earendil-works/pi-ai";
import {
  ModelRuntime as PiModelRuntime,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  type AddCustomModelRequest,
  type DeleteCustomModelRequest,
  type DeleteCustomProviderRequest,
  type PineAuthType,
  type PineCustomModelApi,
  type PineImageModelSelection,
  type PineVideoModelSelection,
  type PineModelCatalog,
  type PineProviderAuthEvent,
  type PineThinkingLevel,
  type PineApprovalModelSelection,
  type PinePromptRewriteModelSelection,
  type PineLiveTranslationModelSelection,
  type PineUtilityModelSelection,
  type ProviderLoginResult,
  type UpdateCustomModelRequest,
  type UpdateCustomProviderRequest,
} from "../../shared/models";
import type { PineAgentEvent } from "../../shared/agent";
import {
  addCustomModel as writeCustomModel,
  deleteCustomModel as removeCustomModel,
  deleteCustomProvider as removeCustomProvider,
  isCustomProviderId,
  readCustomModelsFile,
  updateCustomModel as writeUpdatedCustomModel,
  updateCustomProvider as writeUpdatedCustomProvider,
} from "../customModels";
import {
  DEFAULT_IMAGE_MODEL_ID,
  imageModel,
  imageModelDescriptors,
  IMAGE_MODEL_PROVIDER_ID,
} from "../media/models";
import {
  CHATGPT_AUTH_PROVIDER_ID,
  CHATGPT_IMAGE_PROVIDER_ID,
} from "../media/codex-images";
import {
  readPineAgentSettings,
  writeImageModelSelection,
  writeVideoModelSelection,
  writeApprovalModelSelection,
  writePromptRewriteModelSelection,
  writeLiveTranslationModelSelection,
  writeUtilityModelSelection,
} from "../pineSettings";
import type { PineContextCompactionStrategy } from "../../shared/preferences";
import { decisionsModelDescriptors } from "./decisions-models";
import { videoModelDescriptors } from "../media/video-models";
import type { LiveAgentSession } from "./session-state";
import type { PiProvidersStatus } from "../../shared/piProviders";
import { PiProviderSync } from "./pi-provider-sync";

interface PendingAuthPrompt {
  loginId: string;
  reject: (error: Error) => void;
  resolve: (value: string) => void;
}

export interface PineModelServiceOptions {
  emit: (event: PineAgentEvent | PineProviderAuthEvent) => void;
  getLiveSession: (sessionId: string) => LiveAgentSession | undefined;
  getLiveSessions: () => Iterable<LiveAgentSession>;
  applyContextCompactionStrategy: (
    live: LiveAgentSession,
    strategy: PineContextCompactionStrategy,
  ) => void;
}

/** Owns provider/model configuration and authentication state for the agent runtime. */
export class PineModelService {
  private readonly modelRuntimes = new Map<string, Promise<ModelRuntime>>();
  private readonly piProviderSyncs = new Map<string, PiProviderSync>();
  private readonly loginControllers = new Map<string, AbortController>();
  private readonly pendingAuthPrompts = new Map<string, PendingAuthPrompt>();

  constructor(private readonly options: PineModelServiceOptions) {}

  getModelRuntime(agentDir: string): Promise<ModelRuntime> {
    let runtime = this.modelRuntimes.get(agentDir);
    if (!runtime) {
      runtime = PiModelRuntime.create({
        allowModelNetwork: true,
        authPath: path.join(agentDir, "auth.json"),
        modelsPath: path.join(agentDir, "models.json"),
        modelsStorePath: path.join(agentDir, "models-store.json"),
      }).then(async (created) => {
        const sync = new PiProviderSync(created, agentDir);
        this.piProviderSyncs.set(agentDir, sync);
        // Pi's providers are optional; a broken file never blocks Pine's own.
        await sync.sync().catch(() => undefined);
        return created;
      });
      this.modelRuntimes.set(agentDir, runtime);
    }
    return runtime;
  }

  /** What Pine reads from Pi's models.json; never includes keys. */
  async getPiProvidersStatus(agentDir: string): Promise<PiProvidersStatus> {
    await this.getModelRuntime(agentDir);
    return this.requirePiProviderSync(agentDir).status();
  }

  /** Applies the saved Pi providers setting and re-reads Pi's models.json. */
  async syncPiProviders(agentDir: string): Promise<PiProvidersStatus> {
    await this.getModelRuntime(agentDir);
    return this.requirePiProviderSync(agentDir).sync();
  }

  private requirePiProviderSync(agentDir: string): PiProviderSync {
    const sync = this.piProviderSyncs.get(agentDir);
    if (!sync) throw new Error("The model runtime is not ready.");
    return sync;
  }

  private isPiProvider(agentDir: string, providerId: string): boolean {
    return this.piProviderSyncs.get(agentDir)?.has(providerId) ?? false;
  }

  async getModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    const customModelsFile = await readCustomModelsFile(agentDir);
    const settings = SettingsManager.create(process.cwd(), agentDir, {
      projectTrusted: false,
    });
    await settings.reload();
    const models = runtime.getModels();
    const providers = runtime.getProviders().map((provider) => {
      const status = runtime.getProviderAuthStatus(provider.id);
      const config = customModelsFile.providers[provider.id];
      const isCustom = isCustomProviderId(provider.id) && config !== undefined;
      const fromPi = this.isPiProvider(agentDir, provider.id);
      // Keys for Pi's providers are managed in Pi or CC Switch, not here.
      const authMethods = [];
      if (!fromPi && provider.auth.apiKey?.login) {
        authMethods.push({
          type: "api_key" as const,
          label: provider.auth.apiKey.name,
        });
      }
      if (!fromPi && provider.auth.oauth) {
        authMethods.push({
          type: "oauth" as const,
          label: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
        });
      }
      return {
        id: provider.id,
        name: provider.name,
        configured: status.configured,
        ...(status.label
          ? { authSource: status.label }
          : status.configured
            ? { authSource: status.source }
            : {}),
        authMethods,
        ...(isCustom ? { isCustom: true } : { isCustom: false }),
        ...(isCustom && typeof config.api === "string"
          ? { api: config.api as PineCustomModelApi }
          : {}),
        ...(isCustom && typeof config.baseUrl === "string"
          ? { baseUrl: config.baseUrl }
          : {}),
        ...(isCustom
          ? {
              hasApiKey:
                typeof config.apiKey === "string" && config.apiKey.length > 0,
            }
          : {}),
        modelCount: models.filter((model) => model.provider === provider.id)
          .length,
        ...(fromPi ? { source: "pi" as const, readOnly: true } : {}),
      };
    });
    const defaultProvider = settings.getDefaultProvider();
    const defaultModel = settings.getDefaultModel();
    const defaultThinkingLevel = settings.getDefaultThinkingLevel() ?? "medium";
    const pineSettings = await readPineAgentSettings(agentDir);
    let utilitySelection = pineSettings.utilityModel;
    if (
      !utilitySelection &&
      defaultProvider &&
      defaultModel &&
      runtime.hasConfiguredAuth(defaultProvider) &&
      runtime.getModel(defaultProvider, defaultModel)
    ) {
      utilitySelection = {
        providerId: defaultProvider,
        modelId: defaultModel,
      };
      await writeUtilityModelSelection(agentDir, utilitySelection);
    }
    const validUtilitySelection =
      utilitySelection &&
      runtime.hasConfiguredAuth(utilitySelection.providerId) &&
      runtime.getModel(utilitySelection.providerId, utilitySelection.modelId)
        ? utilitySelection
        : undefined;

    const approvalSelection = pineSettings.approvalModel;
    const validApprovalSelection =
      approvalSelection &&
      runtime.hasConfiguredAuth(approvalSelection.providerId) &&
      runtime.getModel(approvalSelection.providerId, approvalSelection.modelId)
        ? approvalSelection
        : undefined;

    const promptRewriteSelection = pineSettings.promptRewriteModel;
    const validPromptRewriteSelection =
      promptRewriteSelection &&
      runtime.hasConfiguredAuth(promptRewriteSelection.providerId) &&
      runtime.getModel(
        promptRewriteSelection.providerId,
        promptRewriteSelection.modelId,
      )
        ? promptRewriteSelection
        : undefined;

    const liveTranslationSelection = pineSettings.liveTranslationModel;
    const validLiveTranslationSelection =
      liveTranslationSelection &&
      runtime.hasConfiguredAuth(liveTranslationSelection.providerId) &&
      runtime.getModel(
        liveTranslationSelection.providerId,
        liveTranslationSelection.modelId,
      )
        ? liveTranslationSelection
        : undefined;

    const chatGptSignedIn = runtime.hasConfiguredAuth(CHATGPT_AUTH_PROVIDER_ID);
    const effectiveImageSelection = effectiveImageModelSelection(
      pineSettings.imageModel,
      {
        chatGpt: chatGptSignedIn,
        openRouter: runtime.hasConfiguredAuth(IMAGE_MODEL_PROVIDER_ID),
      },
    );

    const [videoModels, decisionsModels] = await Promise.all([
      videoModelDescriptors(agentDir),
      decisionsModelDescriptors(agentDir),
    ]);
    const videoSelection = pineSettings.videoModel;
    return {
      videoModels,
      ...(runtime.hasConfiguredAuth("openrouter") && videoSelection
        ? { videoSelection }
        : {}),
      decisionsModels,
      imageModels: imageModelDescriptors({ chatGptSignedIn }),
      ...(effectiveImageSelection
        ? { imageSelection: effectiveImageSelection }
        : {}),
      providers,
      models: models.map((model) => {
        const descriptor = this.describeModel(
          model,
          providers,
          customModelsFile,
        );
        return this.isPiProvider(agentDir, model.provider)
          ? { ...descriptor, source: "pi" as const }
          : descriptor;
      }),
      ...(validUtilitySelection
        ? { utilitySelection: validUtilitySelection }
        : {}),
      ...(validApprovalSelection
        ? { approvalSelection: validApprovalSelection }
        : {}),
      ...(validPromptRewriteSelection
        ? { promptRewriteSelection: validPromptRewriteSelection }
        : {}),
      ...(validLiveTranslationSelection
        ? { liveTranslationSelection: validLiveTranslationSelection }
        : {}),
      ...(defaultProvider &&
      defaultModel &&
      runtime.hasConfiguredAuth(defaultProvider) &&
      runtime.getModel(defaultProvider, defaultModel)
        ? {
            selection: {
              providerId: defaultProvider,
              modelId: defaultModel,
              thinkingLevel: defaultThinkingLevel,
            },
          }
        : {}),
    };
  }

  async refreshModelCatalog(agentDir: string): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const result = await runtime.refresh({
        allowNetwork: true,
        force: true,
        signal: controller.signal,
      });
      if (result.aborted) {
        throw new Error("Model catalog refresh timed out.");
      }
      if (result.errors.size > 0) {
        const details = Array.from(
          result.errors,
          ([provider, error]) => `${provider}: ${error.message}`,
        ).join("; ");
        throw new Error(`Could not refresh model catalogs: ${details}`);
      }
      await decisionsModelDescriptors(agentDir, { force: true });
      await videoModelDescriptors(agentDir, { force: true });
    } finally {
      clearTimeout(timeout);
    }
    return this.getModelCatalog(agentDir);
  }

  async addCustomModel(
    agentDir: string,
    input: AddCustomModelRequest,
  ): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    if (this.isPiProvider(agentDir, input.providerId)) {
      throw new Error(
        `Provider "${input.providerId}" comes from Pi's models.json. Change it in Pi or CC Switch.`,
      );
    }
    const provider = runtime.getProvider(input.providerId);
    if (input.providerMode === "existing" && !provider) {
      throw new Error(`Provider "${input.providerId}" was not found.`);
    }
    if (input.providerMode === "new" && provider) {
      throw new Error(
        `Provider "${input.providerId}" already exists. Select it as an existing provider instead.`,
      );
    }
    if (runtime.getModel(input.providerId, input.modelId)) {
      throw new Error(
        `Model "${input.modelId}" already exists on provider "${input.providerId}".`,
      );
    }
    await writeCustomModel(agentDir, input);
    await runtime.refresh({ allowNetwork: false });
    const configError = runtime.getError();
    if (configError) throw new Error(configError);
    return this.getModelCatalog(agentDir);
  }

  async updateCustomModel(
    agentDir: string,
    input: UpdateCustomModelRequest,
  ): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    if (!runtime.getModel(input.providerId, input.originalModelId)) {
      throw new Error(
        `Model "${input.originalModelId}" was not found on provider "${input.providerId}".`,
      );
    }
    await writeUpdatedCustomModel(agentDir, input);
    await runtime.refresh({ allowNetwork: false });
    const configError = runtime.getError();
    if (configError) throw new Error(configError);
    return this.getModelCatalog(agentDir);
  }

  async deleteCustomModel(
    agentDir: string,
    input: DeleteCustomModelRequest,
  ): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    await removeCustomModel(agentDir, input);
    await runtime.refresh({ allowNetwork: false });
    const configError = runtime.getError();
    if (configError) throw new Error(configError);
    return this.getModelCatalog(agentDir);
  }

  async updateCustomProvider(
    agentDir: string,
    input: UpdateCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    await writeUpdatedCustomProvider(agentDir, input);
    await runtime.refresh({ allowNetwork: false });
    const configError = runtime.getError();
    if (configError) throw new Error(configError);
    return this.getModelCatalog(agentDir);
  }

  async deleteCustomProvider(
    agentDir: string,
    input: DeleteCustomProviderRequest,
  ): Promise<PineModelCatalog> {
    const runtime = await this.getModelRuntime(agentDir);
    await removeCustomProvider(agentDir, input);
    await runtime.refresh({ allowNetwork: false });
    const configError = runtime.getError();
    if (configError) throw new Error(configError);
    return this.getModelCatalog(agentDir);
  }

  async loginProvider(
    agentDir: string,
    loginId: string,
    providerId: string,
    authType: PineAuthType,
  ): Promise<ProviderLoginResult> {
    if (this.isPiProvider(agentDir, providerId)) {
      throw new Error(
        `Provider "${providerId}" comes from Pi's models.json. Change its key in Pi or CC Switch.`,
      );
    }
    if (this.loginControllers.has(loginId)) {
      throw new Error("Provider login is already in progress.");
    }
    const controller = new AbortController();
    this.loginControllers.set(loginId, controller);
    try {
      const runtime = await this.getModelRuntime(agentDir);
      const credential = await runtime.login(providerId, authType, {
        signal: controller.signal,
        notify: (notice) => {
          this.options.emit({
            type: "provider-auth-notice",
            loginId,
            notice,
          });
        },
        prompt: (prompt) => this.waitForAuthPrompt(loginId, prompt),
      });
      return { credentialType: credential.type };
    } finally {
      this.loginControllers.delete(loginId);
      this.rejectAuthPrompts(loginId, "Provider login ended.");
    }
  }

  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): { accepted: boolean } {
    const pending = this.pendingAuthPrompts.get(promptId);
    if (!pending || pending.loginId !== loginId) return { accepted: false };
    this.pendingAuthPrompts.delete(promptId);
    pending.resolve(value);
    return { accepted: true };
  }

  cancelProviderAuth(loginId: string): { cancelled: boolean } {
    const controller = this.loginControllers.get(loginId);
    if (!controller) return { cancelled: false };
    controller.abort();
    this.rejectAuthPrompts(loginId, "Provider login was cancelled.");
    return { cancelled: true };
  }

  async logoutProvider(
    agentDir: string,
    providerId: string,
  ): Promise<{ disposed: boolean }> {
    await (await this.getModelRuntime(agentDir)).logout(providerId);
    return { disposed: true };
  }

  async selectModel(
    agentDir: string,
    providerId: string,
    modelId: string,
    thinkingLevel: PineThinkingLevel,
    sessionId?: string,
  ): Promise<{ disposed: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    const model = runtime.getModel(providerId, modelId);
    if (!model) throw new Error("Model not found.");
    const available = await runtime.getAvailable(providerId);
    if (!available.some((candidate) => candidate.id === modelId)) {
      throw new Error("Configure this provider before selecting its model.");
    }

    const supported = getSupportedThinkingLevels(model);
    const normalizedThinkingLevel = supported.includes(thinkingLevel)
      ? thinkingLevel
      : (supported.at(-1) ?? "off");
    const live = sessionId ? this.options.getLiveSession(sessionId) : undefined;
    if (sessionId && !live) throw new Error("Session is not active.");
    if (live) {
      await live.session.setModel(model);
      live.session.setThinkingLevel(normalizedThinkingLevel);
      this.options.applyContextCompactionStrategy(
        live,
        live.contextCompactionStrategy,
      );
      await live.session.settingsManager.flush();
    } else {
      const settings = SettingsManager.create(process.cwd(), agentDir, {
        projectTrusted: false,
      });
      settings.setDefaultModelAndProvider(providerId, modelId);
      settings.setDefaultThinkingLevel(normalizedThinkingLevel);
      await settings.flush();
    }
    return { disposed: true };
  }

  async selectUtilityModel(
    agentDir: string,
    selection: PineUtilityModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (!model) throw new Error("Model not found.");
    const available = await runtime.getAvailable(selection.providerId);
    if (!available.some((candidate) => candidate.id === selection.modelId)) {
      throw new Error("Configure this provider before selecting its model.");
    }
    await writeUtilityModelSelection(agentDir, selection);
    return { updated: true };
  }

  async selectApprovalModel(
    agentDir: string,
    selection: PineApprovalModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (!model) throw new Error("Model not found.");
    const available = await runtime.getAvailable(selection.providerId);
    if (!available.some((candidate) => candidate.id === selection.modelId)) {
      throw new Error("Configure this provider before selecting its model.");
    }
    await writeApprovalModelSelection(agentDir, selection);
    return { updated: true };
  }

  async selectPromptRewriteModel(
    agentDir: string,
    selection: PinePromptRewriteModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (!model) throw new Error("Model not found.");
    const available = await runtime.getAvailable(selection.providerId);
    if (!available.some((candidate) => candidate.id === selection.modelId)) {
      throw new Error("Configure this provider before selecting its model.");
    }
    await writePromptRewriteModelSelection(agentDir, selection);
    return { updated: true };
  }

  async selectLiveTranslationModel(
    agentDir: string,
    selection: PineLiveTranslationModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    const model = runtime.getModel(selection.providerId, selection.modelId);
    if (!model) throw new Error("Model not found.");
    const available = await runtime.getAvailable(selection.providerId);
    if (!available.some((candidate) => candidate.id === selection.modelId)) {
      throw new Error("Configure this provider before selecting its model.");
    }
    await writeLiveTranslationModelSelection(agentDir, selection);
    return { updated: true };
  }

  async selectVideoModel(
    agentDir: string,
    selection: PineVideoModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    if (
      selection.providerId !== "openrouter" ||
      !runtime.hasConfiguredAuth("openrouter")
    ) {
      throw new Error("Configure OpenRouter before selecting a video model.");
    }
    const models = await videoModelDescriptors(agentDir, { force: true });
    if (!models.some((model) => model.id === selection.modelId))
      throw new Error("Video model not found.");
    await writeVideoModelSelection(agentDir, selection);
    return { updated: true };
  }

  async selectImageModel(
    agentDir: string,
    selection: PineImageModelSelection,
  ): Promise<{ updated: boolean }> {
    const runtime = await this.getModelRuntime(agentDir);
    if (selection.providerId === CHATGPT_IMAGE_PROVIDER_ID) {
      if (!runtime.hasConfiguredAuth(CHATGPT_AUTH_PROVIDER_ID)) {
        throw new Error(
          "Sign in to OpenAI Codex before selecting ChatGPT image generation.",
        );
      }
    } else if (selection.providerId === IMAGE_MODEL_PROVIDER_ID) {
      if (!runtime.hasConfiguredAuth(IMAGE_MODEL_PROVIDER_ID)) {
        throw new Error(
          "Configure OpenRouter before selecting an image model.",
        );
      }
    } else {
      throw new Error("Unsupported image model provider.");
    }
    if (!imageModel(selection.modelId, selection.providerId)) {
      throw new Error("Image model not found.");
    }
    await writeImageModelSelection(agentDir, selection);
    return { updated: true };
  }

  setContextCompactionStrategy(strategy: PineContextCompactionStrategy): {
    updated: boolean;
  } {
    for (const live of this.options.getLiveSessions()) {
      this.options.applyContextCompactionStrategy(live, strategy);
    }
    return { updated: true };
  }

  async utilityModel(
    agentDir: string,
    runtime: ModelRuntime,
  ): Promise<Model<Api> | undefined> {
    let selection = (await readPineAgentSettings(agentDir)).utilityModel;
    if (!selection) {
      const settings = SettingsManager.create(process.cwd(), agentDir, {
        projectTrusted: false,
      });
      await settings.reload();
      const providerId = settings.getDefaultProvider();
      const modelId = settings.getDefaultModel();
      if (providerId && modelId) {
        selection = { providerId, modelId };
        if (
          runtime.hasConfiguredAuth(providerId) &&
          runtime.getModel(providerId, modelId)
        ) {
          await writeUtilityModelSelection(agentDir, selection);
        }
      }
    }
    if (!selection || !runtime.hasConfiguredAuth(selection.providerId)) {
      return undefined;
    }
    return runtime.getModel(selection.providerId, selection.modelId);
  }

  /** The approval reviewer's model; falls back to the title/utility model. */
  async approvalModel(
    agentDir: string,
    runtime: ModelRuntime,
  ): Promise<Model<Api> | undefined> {
    const selection = (await readPineAgentSettings(agentDir)).approvalModel;
    if (
      selection &&
      runtime.hasConfiguredAuth(selection.providerId) &&
      runtime.getModel(selection.providerId, selection.modelId)
    ) {
      return runtime.getModel(selection.providerId, selection.modelId);
    }
    return this.utilityModel(agentDir, runtime);
  }

  /** The prompt rewriter's model; falls back to the title/utility model. */
  async promptRewriteModel(
    agentDir: string,
    runtime: ModelRuntime,
  ): Promise<Model<Api> | undefined> {
    const selection = (await readPineAgentSettings(agentDir))
      .promptRewriteModel;
    if (
      selection &&
      runtime.hasConfiguredAuth(selection.providerId) &&
      runtime.getModel(selection.providerId, selection.modelId)
    ) {
      return runtime.getModel(selection.providerId, selection.modelId);
    }
    return this.utilityModel(agentDir, runtime);
  }

  /** Live Context translation's model; falls back to the title/utility model. */
  async liveTranslationModel(
    agentDir: string,
    runtime: ModelRuntime,
  ): Promise<Model<Api> | undefined> {
    const selection = (await readPineAgentSettings(agentDir))
      .liveTranslationModel;
    if (
      selection &&
      runtime.hasConfiguredAuth(selection.providerId) &&
      runtime.getModel(selection.providerId, selection.modelId)
    ) {
      return runtime.getModel(selection.providerId, selection.modelId);
    }
    return this.utilityModel(agentDir, runtime);
  }

  dispose(): void {
    for (const controller of this.loginControllers.values()) controller.abort();
    for (const sync of this.piProviderSyncs.values()) sync.dispose();
    this.piProviderSyncs.clear();
  }

  private describeModel(
    model: Model<Api>,
    providers: PineModelCatalog["providers"],
    customModelsFile: Awaited<ReturnType<typeof readCustomModelsFile>>,
  ): PineModelCatalog["models"][number] {
    const providerConfig = customModelsFile.providers[model.provider];
    const customModels = providerConfig?.models;
    const isCustom =
      Array.isArray(customModels) &&
      customModels.some(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          !Array.isArray(candidate) &&
          (candidate as { id?: unknown }).id === model.id,
      );
    return {
      api: model.api,
      contextWindow: model.contextWindow,
      id: model.id,
      input: model.input,
      maxTokens: model.maxTokens,
      name: model.name,
      providerId: model.provider,
      providerName:
        providers.find((provider) => provider.id === model.provider)?.name ??
        model.provider,
      reasoning: model.reasoning,
      supportedThinkingLevels: getSupportedThinkingLevels(model),
      isCustom,
    };
  }

  private waitForAuthPrompt(
    loginId: string,
    prompt: AuthPrompt,
  ): Promise<string> {
    const promptId = randomUUID();
    return new Promise<string>((resolve, reject) => {
      const pending = { loginId, resolve, reject };
      this.pendingAuthPrompts.set(promptId, pending);
      const abort = () => {
        if (this.pendingAuthPrompts.get(promptId) !== pending) return;
        this.pendingAuthPrompts.delete(promptId);
        reject(new Error("Provider login was cancelled."));
      };
      prompt.signal?.addEventListener("abort", abort, { once: true });
      this.loginControllers
        .get(loginId)
        ?.signal.addEventListener("abort", abort, { once: true });
      const serializablePrompt = { ...prompt };
      delete serializablePrompt.signal;
      this.options.emit({
        type: "provider-auth-prompt",
        loginId,
        promptId,
        prompt: serializablePrompt,
      });
    });
  }

  private rejectAuthPrompts(loginId: string, message: string): void {
    for (const [promptId, pending] of this.pendingAuthPrompts) {
      if (pending.loginId !== loginId) continue;
      this.pendingAuthPrompts.delete(promptId);
      pending.reject(new Error(message));
    }
  }
}

/**
 * The image model Pine actually uses. A stored choice wins while its provider
 * is signed in; otherwise OpenRouter's default applies when OpenRouter is
 * configured. ChatGPT is never chosen on the user's behalf.
 */
export function effectiveImageModelSelection(
  stored: PineImageModelSelection | undefined,
  signedIn: { chatGpt: boolean; openRouter: boolean },
): PineImageModelSelection | undefined {
  if (stored && imageModel(stored.modelId, stored.providerId)) {
    if (stored.providerId === CHATGPT_IMAGE_PROVIDER_ID && signedIn.chatGpt) {
      return stored;
    }
    if (stored.providerId === IMAGE_MODEL_PROVIDER_ID && signedIn.openRouter) {
      return stored;
    }
  }
  return signedIn.openRouter
    ? { modelId: DEFAULT_IMAGE_MODEL_ID, providerId: IMAGE_MODEL_PROVIDER_ID }
    : undefined;
}
