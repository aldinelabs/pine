import { defineStore } from "pinia";
import { ref } from "vue";
import { preferenceStorage } from "@/lib/preferenceStorage";

export const ARTIFACT_FOLDERS_STORAGE_KEY = "pine.artifact-folders.v1";
/** Only the most recently changed sessions keep their collapsed folders. */
const MAX_STORED_SESSIONS = 200;

function readCollapsed(): Map<string, string[]> {
  const collapsed = new Map<string, string[]>();
  try {
    const value: unknown = JSON.parse(
      preferenceStorage.getItem(ARTIFACT_FOLDERS_STORAGE_KEY) ?? "null",
    );
    if (typeof value !== "object" || value === null) return collapsed;
    for (const [key, folders] of Object.entries(value)) {
      if (!Array.isArray(folders)) continue;
      const paths = folders.filter(
        (folder): folder is string => typeof folder === "string" && !!folder,
      );
      if (paths.length) collapsed.set(key, paths);
    }
  } catch {
    // Corrupt or unavailable storage shows every folder expanded.
  }
  return collapsed;
}

/**
 * Which Artifacts folders each session has collapsed. Folders start
 * expanded, so a folder the agent creates later is visible.
 */
export const useArtifactFoldersStore = defineStore("artifactFolders", () => {
  const collapsed = ref(readCollapsed());

  function save(): void {
    try {
      preferenceStorage.setItem(
        ARTIFACT_FOLDERS_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(collapsed.value)),
      );
    } catch {
      // Unavailable storage keeps the state for this window only.
    }
  }

  function isExpanded(sessionId: string, folder: string): boolean {
    return !collapsed.value.get(sessionId)?.includes(folder);
  }

  function setExpanded(
    sessionId: string,
    folder: string,
    expanded: boolean,
  ): void {
    if (isExpanded(sessionId, folder) === expanded) return;
    const current = collapsed.value.get(sessionId) ?? [];
    const next = expanded
      ? current.filter((path) => path !== folder)
      : [...current, folder];
    // Re-inserting keeps the most recently changed sessions last.
    collapsed.value.delete(sessionId);
    if (next.length) collapsed.value.set(sessionId, next);
    for (const stale of collapsed.value.keys()) {
      if (collapsed.value.size <= MAX_STORED_SESSIONS) break;
      collapsed.value.delete(stale);
    }
    save();
  }

  return { isExpanded, setExpanded };
});
