import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type { PineUpdateInfo } from "@/shared/updates";

export type UpdatePhase =
  "idle" | "available" | "downloading" | "ready" | "installing" | "error";

export const useUpdaterStore = defineStore("updater", () => {
  const phase = ref<UpdatePhase>("idle");
  const update = ref<PineUpdateInfo>();
  const progress = ref(0);
  const error = ref<string>();
  // Shared so the title bar notice and the first-found prompt open one dialog.
  const isDialogOpen = ref(false);
  const isAvailable = computed(() => update.value !== undefined);
  let initialized = false;

  async function check(): Promise<void> {
    if (typeof window.pine?.checkForUpdate !== "function") return;
    try {
      const result = await window.pine.checkForUpdate();
      if (result.status === "available") {
        update.value = result.update;
        if (phase.value === "idle") phase.value = "available";
      }
    } catch {
      // Update checks are background work and must not interrupt the workspace.
    }
  }

  function initialize(): void {
    if (initialized) return;
    initialized = true;
    window.pine?.onUpdateEvent?.((event) => {
      if (event.type === "download-progress") {
        phase.value = "downloading";
        progress.value = event.percent;
      } else if (event.type === "download-ready") {
        phase.value = "ready";
        progress.value = 100;
      } else {
        phase.value = "error";
        error.value = event.message;
      }
    });
    void check();
    window.setInterval(() => void check(), 4 * 60 * 60_000);
  }

  async function download(): Promise<void> {
    if (typeof window.pine?.downloadUpdate !== "function") return;
    phase.value = "downloading";
    progress.value = 0;
    error.value = undefined;
    try {
      await window.pine.downloadUpdate();
    } catch (cause) {
      phase.value = "error";
      error.value = String(cause);
    }
  }

  async function install(): Promise<void> {
    if (typeof window.pine?.installUpdate !== "function") return;
    phase.value = "installing";
    error.value = undefined;
    try {
      await window.pine.installUpdate();
    } catch (cause) {
      phase.value = "error";
      error.value = String(cause);
    }
  }

  return {
    check,
    download,
    error,
    initialize,
    install,
    isAvailable,
    isDialogOpen,
    phase,
    progress,
    update,
  };
});
