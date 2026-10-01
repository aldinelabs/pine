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
    /**
     * True while the window clips a closing sidebar: the sidebar is still
     * expanded, but the content titlebar already makes room for the trailing
     * window controls that follow the moving window edge.
     */
    const isClosing = ref(false);

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

    function setClosing(value: boolean): void {
      isClosing.value = value;
    }

    return { open, isClosing, setOpen, setClosing, toggle };
  },
);
