import { defineStore } from "pinia";
import { ref } from "vue";

export const PROJECT_RIGHT_SIDEBAR_STORAGE_KEY =
  "pine.project-right-sidebar.v1";

function readOpen(): boolean {
  try {
    return (
      window.localStorage.getItem(PROJECT_RIGHT_SIDEBAR_STORAGE_KEY) !== "false"
    );
  } catch {
    // Unavailable storage falls back to the default open layout.
    return true;
  }
}

export const useProjectRightSidebarStore = defineStore(
  "project-right-sidebar",
  () => {
    const open = ref(readOpen());

    function setOpen(value: boolean): void {
      open.value = value;
      try {
        window.localStorage.setItem(
          PROJECT_RIGHT_SIDEBAR_STORAGE_KEY,
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
