import { defineStore } from "pinia";
import { ref } from "vue";

export const SESSION_HISTORY_STORAGE_KEY = "pine.session-history.collapsed.v1";
const PAGE_SIZE = 5;

function readCollapsed(): Set<string> {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(SESSION_HISTORY_STORAGE_KEY) ?? "[]",
    );
    if (Array.isArray(value)) {
      return new Set(
        value.filter((id): id is string => typeof id === "string"),
      );
    }
  } catch {
    // Unavailable or corrupt preferences fall back to expanded projects.
  }
  return new Set();
}

export const useSessionHistoryStore = defineStore("session-history", () => {
  const collapsed = ref(readCollapsed());
  const visibleCounts = ref(new Map<string, number>());

  function isOpen(projectId: string): boolean {
    return !collapsed.value.has(projectId);
  }

  function setOpen(projectId: string, open: boolean): void {
    if (open === isOpen(projectId)) return;
    if (open) collapsed.value.delete(projectId);
    else collapsed.value.add(projectId);
    try {
      window.localStorage.setItem(
        SESSION_HISTORY_STORAGE_KEY,
        JSON.stringify([...collapsed.value]),
      );
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }

  function visibleCount(projectId: string): number {
    return visibleCounts.value.get(projectId) ?? PAGE_SIZE;
  }

  function showMore(projectId: string): void {
    visibleCounts.value.set(projectId, visibleCount(projectId) + PAGE_SIZE);
  }

  return { collapsed, visibleCounts, isOpen, setOpen, visibleCount, showMore };
});
