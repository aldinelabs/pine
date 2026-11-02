export const PREFERENCES_SNAPSHOT_CHANNEL = "preferences:snapshot" as const;
export const PREFERENCES_SET_CHANNEL = "preferences:set" as const;
export const PREFERENCES_REMOVE_CHANNEL = "preferences:remove" as const;

/** Renderer UI preferences all live under this key prefix. */
export const PREFERENCE_KEY_PREFIX = "pine.";
export const MAX_PREFERENCE_KEY_LENGTH = 256;
export const MAX_PREFERENCE_VALUE_LENGTH = 1_000_000;

export interface PinePreferencesApi {
  /** Everything stored, read once when the window's preload runs. */
  snapshot: Record<string, string>;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PinePreferenceStorageApi {
  /**
   * UI preferences kept by the main process, so they survive a change of the
   * renderer's origin (a dev server on another port) and a cleared web cache.
   */
  preferences?: PinePreferencesApi;
}
