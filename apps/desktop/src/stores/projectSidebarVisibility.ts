import { defineStore } from "pinia";
import { ref } from "vue";

export const PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY =
  "pine.project-sidebar-visibility.v1";

function readOpen(): boolean {
  try {
    return (
      window.localStorage.getItem(PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY) !==
      "false"
    );
  } catch {
    // Unavailable storage falls back to the default open layout.
    return true;
  }
}

export const useProjectSidebarVisibilityStore = defineStore(
  "project-sidebar-visibility",
  () => {
    const open = ref(readOpen());
    function setOpen(value: boolean): void {
      open.value = value;
      try {
        window.localStorage.setItem(
          PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY,
          String(value),
        );
      } catch {
        // Keep the in-memory preference when storage is unavailable.
      }
    }

    function toggle(): void {
      setOpen(!open.value);
    }

    return { open, setOpen, toggle };
  },
);
