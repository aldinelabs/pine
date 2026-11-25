import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import type { AssistantState } from "@/shared/assistant";
import type { PineSessionSummary } from "@/shared/sessions";

/**
 * Pine's Assistant as the window sees it: its one conversation, an ordinary
 * session pinned above every project. Opening it in a tab is
 * useAssistantEntry's job.
 */
export const useAssistantStore = defineStore("assistant", () => {
  const session = shallowRef<PineSessionSummary | null>(null);
  const isLoading = ref(false);
  const isLoaded = ref(false);
  let loadInFlight: Promise<AssistantState> | undefined;

  function apply(state: AssistantState): AssistantState {
    session.value = state.session ?? null;
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

  return { isLoaded, isLoading, load, session };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAssistantStore, import.meta.hot));
}
