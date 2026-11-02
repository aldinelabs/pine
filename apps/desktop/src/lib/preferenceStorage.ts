import type { PinePreferencesApi } from "@/shared/preferenceStorage";
import { PREFERENCE_KEY_PREFIX } from "@/shared/preferenceStorage";

const writableSnapshots = new WeakMap<
  PinePreferencesApi,
  Record<string, string>
>();

/**
 * The main process's preferences plus this window's own changes. The bridge
 * hands the renderer a frozen copy of the snapshot, so changes are kept in a
 * writable copy of it.
 */
function mainProcessPreferences():
  { api: PinePreferencesApi; values: Record<string, string> } | undefined {
  const api = window.pine?.preferences;
  if (!api) return undefined;
  let values = writableSnapshots.get(api);
  if (!values) {
    values = { ...api.snapshot };
    writableSnapshots.set(api, values);
  }
  return { api, values };
}

/**
 * Where renderer UI preferences live. The desktop app keeps them in the main
 * process, which a change of the renderer's origin (a dev server moving to
 * another port) cannot lose. A browser client has no main process and uses
 * its own web storage. Reads are synchronous because stores read them while
 * they are created; throws like web storage when it is unavailable.
 */
export const preferenceStorage = {
  getItem(key: string): string | null {
    const preferences = mainProcessPreferences();
    if (preferences) return preferences.values[key] ?? null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    const preferences = mainProcessPreferences();
    if (preferences) {
      preferences.values[key] = value;
      preferences.api.set(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    const preferences = mainProcessPreferences();
    if (preferences) {
      delete preferences.values[key];
      preferences.api.remove(key);
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
  const preferences = mainProcessPreferences();
  if (!preferences) return;
  try {
    const stored = window.localStorage;
    for (let index = 0; index < stored.length; index += 1) {
      const key = stored.key(index);
      if (!key?.startsWith(PREFERENCE_KEY_PREFIX)) continue;
      if (key in preferences.values) continue;
      const value = stored.getItem(key);
      if (value !== null) preferenceStorage.setItem(key, value);
    }
  } catch {
    // Unavailable web storage has nothing to carry over.
  }
}
