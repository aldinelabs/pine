import { defineStore } from "pinia";
import { reactive } from "vue";

export const PROJECT_SIDEBAR_STORAGE_PREFIX = "pine.project-sidebar.v1:";
/** The file tree's state of each project. */
interface FileTreeState {
  expanded: string[];
}

function readState(projectId: string): FileTreeState {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(PROJECT_SIDEBAR_STORAGE_PREFIX + projectId) ??
        "null",
    );
    if (typeof value === "object" && value !== null) {
      return {
        expanded:
          "expanded" in value && Array.isArray(value.expanded)
            ? value.expanded.filter(
                (key): key is string => typeof key === "string",
              )
            : [],
      };
    }
  } catch {
    // Corrupt or unavailable storage must not prevent opening the project.
  }
  return { expanded: [] };
}

export const useProjectSidebarStore = defineStore("project-sidebar", () => {
  const projects = reactive(new Map<string, FileTreeState>());

  function stateFor(projectId: string): FileTreeState {
    if (!projects.has(projectId)) projects.set(projectId, readState(projectId));
    return projects.get(projectId)!;
  }

  function setExpanded(projectId: string, expanded: string[]): void {
    const state = { ...stateFor(projectId), expanded: [...new Set(expanded)] };
    projects.set(projectId, state);
    try {
      window.localStorage.setItem(
        PROJECT_SIDEBAR_STORAGE_PREFIX + projectId,
        JSON.stringify(state),
      );
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }

  return { stateFor, setExpanded };
});
