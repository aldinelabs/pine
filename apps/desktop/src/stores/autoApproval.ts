import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  type PineAutoApprovalSettings,
} from "@/shared/preferences";

export const useAutoApprovalStore = defineStore("autoApproval", () => {
  const settings = ref<PineAutoApprovalSettings>({
    ...DEFAULT_AUTO_APPROVAL_SETTINGS,
  });
  const isLoading = ref(true);
  const isSaving = ref(false);
  let loadInFlight: Promise<void> | undefined;

  async function load(): Promise<void> {
    if (isSaving.value) return;
    if (loadInFlight) return loadInFlight;
    isLoading.value = true;
    loadInFlight = (async () => {
      try {
        settings.value = await window.pine.getAutoApprovalSettings();
      } finally {
        isLoading.value = false;
        loadInFlight = undefined;
      }
    })();
    return loadInFlight;
  }

  async function save(value: PineAutoApprovalSettings): Promise<void> {
    if (isLoading.value || isSaving.value) return;
    isSaving.value = true;
    try {
      settings.value = await window.pine.setAutoApprovalSettings({ ...value });
    } finally {
      isSaving.value = false;
    }
  }

  return { settings, isLoading, isSaving, load, save };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useAutoApprovalStore, import.meta.hot),
  );
}
