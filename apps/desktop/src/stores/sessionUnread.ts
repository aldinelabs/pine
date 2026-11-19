import { useDocumentVisibility, useWindowFocus } from "@vueuse/core";
import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { preferenceStorage } from "@/lib/preferenceStorage";

export const SESSION_UNREAD_STORAGE_KEY = "pine.session-unread.v1";
/** Enough for any sidebar; the oldest marks go first past it. */
export const MAX_UNREAD_SESSIONS = 200;

function readUnread(): Set<string> {
  try {
    const value: unknown = JSON.parse(
      preferenceStorage.getItem(SESSION_UNREAD_STORAGE_KEY) ?? "[]",
    );
    if (Array.isArray(value))
      return new Set(
        value.filter((id): id is string => typeof id === "string"),
      );
  } catch {
    // Unavailable or corrupt preferences start with nothing unread.
  }
  return new Set();
}

/** Whether the user can see this window's content right now. */
function isWindowAttentive(): boolean {
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Sessions with assistant output the user has not seen: a run that finished
 * while the session was not the one shown in a focused window. Opening or
 * returning to the session reads it. Kept in the renderer preferences so it
 * survives a restart.
 */
export const useSessionUnreadStore = defineStore("session-unread", () => {
  const unreadIds = ref<ReadonlySet<string>>(readUnread());

  function persist(): void {
    try {
      preferenceStorage.setItem(
        SESSION_UNREAD_STORAGE_KEY,
        JSON.stringify([...unreadIds.value]),
      );
    } catch {
      // Keep the in-memory marks when storage is unavailable.
    }
  }

  function isUnread(sessionId: string): boolean {
    return unreadIds.value.has(sessionId);
  }

  function markUnread(sessionId: string): void {
    if (unreadIds.value.has(sessionId)) return;
    const next = [...unreadIds.value, sessionId];
    unreadIds.value = new Set(next.slice(-MAX_UNREAD_SESSIONS));
    persist();
  }

  function markRead(sessionId: string): void {
    if (!unreadIds.value.has(sessionId)) return;
    const next = new Set(unreadIds.value);
    next.delete(sessionId);
    unreadIds.value = next;
    persist();
  }

  /**
   * A run of the session ended. It stays read only when the user is looking
   * at it: it is the session shown and the window is visible and focused.
   */
  function noteRunFinished(
    sessionId: string,
    shownSessionId: string | null,
  ): void {
    if (sessionId === shownSessionId && isWindowAttentive()) return;
    markUnread(sessionId);
  }

  /**
   * Reads the session shown whenever the user can see it: on opening it, and
   * on coming back to a window left in the background.
   */
  function trackReading(shownSessionId: MaybeRefOrGetter<string | null>) {
    const focused = useWindowFocus();
    const visibility = useDocumentVisibility();
    return watch(
      [() => toValue(shownSessionId), focused, visibility],
      ([sessionId, isFocused, visible]) => {
        if (sessionId && isFocused && visible === "visible")
          markRead(sessionId);
      },
      { immediate: true },
    );
  }

  return {
    unreadIds,
    isUnread,
    markUnread,
    markRead,
    noteRunFinished,
    trackReading,
  };
});

if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useSessionUnreadStore, import.meta.hot),
  );
