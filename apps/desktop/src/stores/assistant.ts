import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantSettings,
  type AssistantState,
} from "@/shared/assistant";
import type { PineSessionSummary } from "@/shared/sessions";

/**
 * Pine's Assistant as the window sees it: its one conversation and its
 * settings. Opening it in a tab is useAssistantEntry's job.
 */
export const useAssistantStore = defineStore("assistant", () => {
  const session = shallowRef<PineSessionSummary | null>(null);
  const settings = ref<AssistantSettings>({ ...DEFAULT_ASSISTANT_SETTINGS });
  const isLoading = ref(false);
  const isLoaded = ref(false);
  const isSaving = ref(false);
  let loadInFlight: Promise<AssistantState> | undefined;
  /** Counts asks to show Settings › Assistant; the window's view opens it. */
  const settingsRequests = ref(0);

  function requestSettings(): void {
    settingsRequests.value += 1;
  }

  function apply(state: AssistantState): AssistantState {
    session.value = state.session ?? null;
    settings.value = state.settings;
    isLoaded.value = true;
    return state;
  }

  function load(): Promise<AssistantState> {
    if (loadInFlight) return loadInFlight;
    isLoading.value = true;
    loadInFlight = Promise.resolve()
      .then(() => window.pine.getAssistant())
      .then(apply)
      .finally(() => {
        isLoading.value = false;
        loadInFlight = undefined;
      });
    return loadInFlight;
  }

  async function saveSettings(next: AssistantSettings): Promise<void> {
    if (isSaving.value) return;
    isSaving.value = true;
    try {
      settings.value = await window.pine.setAssistantSettings({ ...next });
    } finally {
      isSaving.value = false;
    }
  }

  /** Deletes the conversation; the next message starts a new one. */
  async function clear(): Promise<boolean> {
    const { cleared } = await window.pine.clearAssistant();
    if (cleared) session.value = null;
    return cleared;
  }

  return {
    clear,
    isLoaded,
    isLoading,
    isSaving,
    load,
    requestSettings,
    saveSettings,
    session,
    settings,
    settingsRequests,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAssistantStore, import.meta.hot));
}
