import { PREFERENCE_KEY_PREFIX } from "@/shared/preferenceStorage";

/**
 * Where renderer UI preferences live. The desktop app keeps them in the main
 * process, which a change of the renderer's origin (a dev server moving to
 * another port) cannot lose. A browser client has no main process and uses
 * its own web storage. Reads are synchronous because stores read them while
 * they are created; throws like web storage when it is unavailable.
 */
export const preferenceStorage = {
  getItem(key: string): string | null {
    const preferences = window.pine?.preferences;
    if (preferences) return preferences.snapshot[key] ?? null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    const preferences = window.pine?.preferences;
    if (preferences) {
      preferences.snapshot[key] = value;
      preferences.set(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    const preferences = window.pine?.preferences;
    if (preferences) {
      delete preferences.snapshot[key];
      preferences.remove(key);
      return;
    }
    window.localStorage.removeItem(key);
  },
};

/**
 * Carries preferences a previous build kept in this origin's web storage into
 * the main process once, without overwriting anything it already has.
 */
export function adoptWebStoragePreferences(): void {
  const preferences = window.pine?.preferences;
  if (!preferences) return;
  try {
    const stored = window.localStorage;
    for (let index = 0; index < stored.length; index += 1) {
      const key = stored.key(index);
      if (!key?.startsWith(PREFERENCE_KEY_PREFIX)) continue;
      if (key in preferences.snapshot) continue;
      const value = stored.getItem(key);
      if (value !== null) preferenceStorage.setItem(key, value);
    }
  } catch {
    // Unavailable web storage has nothing to carry over.
  }
}
