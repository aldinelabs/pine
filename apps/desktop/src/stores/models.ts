import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type {
  AddCustomModelRequest,
  DeleteCustomModelRequest,
  DeleteCustomProviderRequest,
  PineAuthType,
  PineImageModelDescriptor,
  PineModelCatalog,
  PineModelDescriptor,
  PineModelSelection,
  PineProviderAuthNotice,
  PineProviderAuthPrompt,
  PineProviderDescriptor,
  UpdateCustomModelRequest,
  UpdateCustomProviderRequest,
} from "@/shared/models";

interface ProviderLoginState {
  authType: PineAuthType;
  error?: string;
  isRunning: boolean;
  loginId: string;
  notices: PineProviderAuthNotice[];
  prompt?: PineProviderAuthPrompt & { promptId: string };
  providerId: string;
}

export const MODEL_FAVORITES_STORAGE_KEY = "pine.models.favorites";
export const MODEL_RECENTS_STORAGE_KEY = "pine.models.recents";
const RECENT_MODEL_LIMIT = 5;
const DEFAULT_THINKING_LEVEL_PRIORITY: readonly PineModelSelection["thinkingLevel"][] =
  ["medium", "high", "low", "xhigh", "max", "off"];

export function pineModelKey(
  model: Pick<PineModelDescriptor, "id" | "providerId">,
): string {
  return JSON.stringify([model.providerId, model.id]);
}

export function defaultThinkingLevel(
  supportedLevels: readonly PineModelSelection["thinkingLevel"][],
): PineModelSelection["thinkingLevel"] {
  return (
    DEFAULT_THINKING_LEVEL_PRIORITY.find((level) =>
      supportedLevels.includes(level),
    ) ?? "off"
  );
}

function readStoredModelKeys(storageKey: string): string[] {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "[]",
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((item): item is string => typeof item === "string"),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function persistModelKeys(storageKey: string, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(keys));
  } catch {
    // The model list still works for this session if storage is unavailable.
  }
}

/**
 * The catalog comes back from the main process as fresh objects on every read,
 * so identity comparison can never short-circuit a re-render. Comparing the
 * payload keeps the store from republishing an identical catalog (and dragging
 * every model row through another render pass) each time a picker opens.
 */
function isSameCatalog(
  next: PineModelCatalog,
  current: PineModelCatalog,
): boolean {
  if (
    next.models.length !== current.models.length ||
    next.providers.length !== current.providers.length
  ) {
    return false;
  }
  return JSON.stringify(next) === JSON.stringify(current);
}

export const useModelsStore = defineStore("models", () => {
  const catalog = shallowRef<PineModelCatalog>({ models: [], providers: [] });
  const favoriteModelKeys = ref<string[]>(
    readStoredModelKeys(MODEL_FAVORITES_STORAGE_KEY),
  );
  const recentModelKeys = ref<string[]>(
    readStoredModelKeys(MODEL_RECENTS_STORAGE_KEY),
  );
  const isLoading = ref(false);
  const login = ref<ProviderLoginState | null>(null);
  const sessionSelections = ref<Record<string, PineModelSelection>>({});
  let stopAuthEvents: (() => void) | null = null;

  const models = computed(() => catalog.value.models);
  const providers = computed(() => catalog.value.providers);
  const selection = computed(() => catalog.value.selection);
  const utilitySelection = computed(() => catalog.value.utilitySelection);
  const recommendedModelIds = computed(
    () => new Set(catalog.value.recommendedModelIds ?? []),
  );
  const selectedModel = computed(() => {
    const selected = selection.value;
    return selected
      ? models.value.find(
          (model) =>
            model.providerId === selected.providerId &&
            model.id === selected.modelId,
        )
      : undefined;
  });

  function selectionFor(sessionId?: string): PineModelSelection | undefined {
    return sessionId ? sessionSelections.value[sessionId] : selection.value;
  }

  function selectedModelFor(
    sessionId?: string,
  ): PineModelDescriptor | undefined {
    const selected = selectionFor(sessionId);
    return selected
      ? models.value.find(
          (model) =>
            model.providerId === selected.providerId &&
            model.id === selected.modelId,
        )
      : undefined;
  }

  function setSessionSelection(
    sessionId: string,
    nextSelection: PineModelSelection | undefined,
  ): void {
    if (nextSelection) {
      sessionSelections.value = {
        ...sessionSelections.value,
        [sessionId]: nextSelection,
      };
      return;
    }
    const next = { ...sessionSelections.value };
    delete next[sessionId];
    sessionSelections.value = next;
  }

  function clearSessionSelections(): void {
    sessionSelections.value = {};
  }

  const utilitySelectedModel = computed(() => {
    const selected = utilitySelection.value;
    return selected
      ? models.value.find(
          (model) =>
            model.providerId === selected.providerId &&
            model.id === selected.modelId,
        )
      : undefined;
  });
  const decisionsModels = computed(() => catalog.value.decisionsModels ?? []);
  const imageModels = computed(() => catalog.value.imageModels ?? []);
  const imageSelection = computed(() => catalog.value.imageSelection);
  const imageProviderConfigured = computed(
    () =>
      providers.value.find((provider) => provider.id === "openrouter")
        ?.configured === true,
  );
  const imageSelectedModel = computed(() => {
    const selected = imageSelection.value;
    return selected
      ? imageModels.value.find(
          (model) =>
            model.providerId === selected.providerId &&
            model.id === selected.modelId,
        )
      : undefined;
  });
  const configuredProviders = computed(() =>
    providers.value.filter((provider) => provider.configured),
  );
  const configuredProviderIds = computed(
    () => new Set(configuredProviders.value.map((provider) => provider.id)),
  );
  const availableModelsByKey = computed(
    () =>
      new Map(
        models.value
          .filter((model) => configuredProviderIds.value.has(model.providerId))
          .map((model) => [pineModelKey(model), model]),
      ),
  );
  const favoriteModels = computed(() =>
    favoriteModelKeys.value.flatMap((key) => {
      const model = availableModelsByKey.value.get(key);
      return model ? [model] : [];
    }),
  );
  const recentModels = computed(() =>
    recentModelKeys.value.flatMap((key) => {
      const model = availableModelsByKey.value.get(key);
      return model ? [model] : [];
    }),
  );
  const featuredModels = computed(() =>
    favoriteModels.value.length > 0 ? favoriteModels.value : recentModels.value,
  );

  function recordRecent(model: PineModelDescriptor): void {
    const key = pineModelKey(model);
    const next = [
      key,
      ...recentModelKeys.value.filter((candidate) => candidate !== key),
    ].slice(0, RECENT_MODEL_LIMIT);
    if (
      next.length === recentModelKeys.value.length &&
      next.every(
        (candidate, index) => candidate === recentModelKeys.value[index],
      )
    ) {
      return;
    }
    recentModelKeys.value = next;
    persistModelKeys(MODEL_RECENTS_STORAGE_KEY, recentModelKeys.value);
  }

  function isFavorite(model: PineModelDescriptor): boolean {
    return favoriteModelKeys.value.includes(pineModelKey(model));
  }

  function favoriteModelKeysSnapshot(): readonly string[] {
    return [...favoriteModelKeys.value];
  }

  function isRecommended(model: PineModelDescriptor): boolean {
    return recommendedModelIds.value.has(model.id);
  }

  function toggleFavorite(model: PineModelDescriptor): void {
    const key = pineModelKey(model);
    favoriteModelKeys.value = isFavorite(model)
      ? favoriteModelKeys.value.filter((candidate) => candidate !== key)
      : [...favoriteModelKeys.value, key];
    persistModelKeys(MODEL_FAVORITES_STORAGE_KEY, favoriteModelKeys.value);
  }

  function connectAuthEvents(): void {
    if (stopAuthEvents) return;
    stopAuthEvents = window.pine.onProviderAuthEvent((event) => {
      if (!login.value || event.loginId !== login.value.loginId) return;
      if (event.type === "provider-auth-prompt") {
        login.value.prompt = {
          ...event.prompt,
          promptId: event.promptId,
        };
      } else {
        login.value.notices.push(event.notice);
      }
    });
  }

  async function load(): Promise<void> {
    isLoading.value = true;
    try {
      const nextCatalog = await window.pine.getModelCatalog();
      if (!isSameCatalog(nextCatalog, catalog.value)) {
        catalog.value = nextCatalog;
      }
      const selected = selectedModel.value;
      if (selected) recordRecent(selected);
    } finally {
      isLoading.value = false;
    }
  }

  async function addCustomModel(input: AddCustomModelRequest): Promise<void> {
    catalog.value = await window.pine.addCustomModel(input);
  }

  async function updateCustomModel(
    input: UpdateCustomModelRequest,
  ): Promise<void> {
    catalog.value = await window.pine.updateCustomModel(input);
  }

  async function deleteCustomModel(
    input: DeleteCustomModelRequest,
  ): Promise<void> {
    catalog.value = await window.pine.deleteCustomModel(input);
  }

  async function updateCustomProvider(
    input: UpdateCustomProviderRequest,
  ): Promise<void> {
    catalog.value = await window.pine.updateCustomProvider(input);
  }

  async function deleteCustomProvider(
    input: DeleteCustomProviderRequest,
  ): Promise<void> {
    catalog.value = await window.pine.deleteCustomProvider(input);
  }

  async function select(
    model: PineModelDescriptor,
    thinkingLevel?: PineModelSelection["thinkingLevel"],
    sessionId?: string,
  ): Promise<void> {
    const nextThinkingLevel =
      thinkingLevel ?? defaultThinkingLevel(model.supportedThinkingLevels);
    await window.pine.selectModel({
      providerId: model.providerId,
      modelId: model.id,
      ...(sessionId ? { sessionId } : {}),
      thinkingLevel: nextThinkingLevel,
    });
    const nextSelection: PineModelSelection = {
      providerId: model.providerId,
      modelId: model.id,
      thinkingLevel: nextThinkingLevel,
    };
    if (sessionId) setSessionSelection(sessionId, nextSelection);
    else catalog.value = { ...catalog.value, selection: nextSelection };
    recordRecent(model);
  }

  async function setThinkingLevel(
    thinkingLevel: PineModelSelection["thinkingLevel"],
    sessionId?: string,
  ): Promise<void> {
    const model = selectedModelFor(sessionId);
    if (!model) return;
    await select(model, thinkingLevel, sessionId);
  }

  async function selectUtilityModel(model: PineModelDescriptor): Promise<void> {
    await window.pine.selectUtilityModel({
      providerId: model.providerId,
      modelId: model.id,
    });
    catalog.value = {
      ...catalog.value,
      utilitySelection: {
        providerId: model.providerId,
        modelId: model.id,
      },
    };
  }

  async function selectImageModel(
    model: PineImageModelDescriptor,
  ): Promise<void> {
    await window.pine.selectImageModel({
      providerId: model.providerId,
      modelId: model.id,
    });
    catalog.value = {
      ...catalog.value,
      imageSelection: {
        providerId: model.providerId,
        modelId: model.id,
      },
    };
  }

  async function beginLogin(
    provider: PineProviderDescriptor,
    authType: PineAuthType,
  ): Promise<void> {
    connectAuthEvents();
    const loginId = crypto.randomUUID();
    login.value = {
      authType,
      isRunning: true,
      loginId,
      notices: [],
      providerId: provider.id,
    };
    try {
      await window.pine.loginProvider({
        authType,
        loginId,
        providerId: provider.id,
      });
      await load();
      if (login.value?.loginId === loginId) login.value.isRunning = false;
    } catch (error) {
      if (login.value?.loginId === loginId) {
        login.value.isRunning = false;
        login.value.error =
          error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
  }

  async function respondToPrompt(value: string): Promise<void> {
    const activeLogin = login.value;
    const prompt = activeLogin?.prompt;
    if (!activeLogin || !prompt) return;
    const result = await window.pine.respondToProviderAuth({
      loginId: activeLogin.loginId,
      promptId: prompt.promptId,
      value,
    });
    if (result.accepted && login.value?.loginId === activeLogin.loginId) {
      login.value.prompt = undefined;
    }
  }

  async function cancelLogin(): Promise<void> {
    const activeLogin = login.value;
    login.value = null;
    if (activeLogin?.isRunning) {
      await window.pine.cancelProviderAuth({ loginId: activeLogin.loginId });
    }
  }

  function clearLogin(): void {
    if (!login.value?.isRunning) login.value = null;
  }

  async function logout(providerId: string): Promise<void> {
    await window.pine.logoutProvider({ providerId });
    await load();
  }

  return {
    addCustomModel,
    deleteCustomModel,
    deleteCustomProvider,
    beginLogin,
    cancelLogin,
    catalog,
    clearSessionSelections,
    clearLogin,
    configuredProviders,
    connectAuthEvents,
    favoriteModels,
    favoriteModelKeysSnapshot,
    featuredModels,
    decisionsModels,
    imageModels,
    imageProviderConfigured,
    imageSelectedModel,
    imageSelection,
    isFavorite,
    isRecommended,
    isLoading,
    load,
    login,
    logout,
    models,
    providers,
    recentModels,
    respondToPrompt,
    select,
    selectImageModel,
    selectUtilityModel,
    selectedModel,
    selectedModelFor,
    selection,
    selectionFor,
    sessionSelections,
    setSessionSelection,
    setThinkingLevel,
    toggleFavorite,
    updateCustomModel,
    updateCustomProvider,
    utilitySelectedModel,
    utilitySelection,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useModelsStore, import.meta.hot));
}
