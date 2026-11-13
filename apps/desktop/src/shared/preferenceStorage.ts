export const PREFERENCES_SNAPSHOT_CHANNEL = "preferences:snapshot" as const;
export const PREFERENCES_SET_CHANNEL = "preferences:set" as const;
export const PREFERENCES_REMOVE_CHANNEL = "preferences:remove" as const;
/** Main → renderer: another window changed a preference. */
export const PREFERENCES_CHANGED_CHANNEL = "preferences:changed" as const;

/** Renderer UI preferences all live under this key prefix. */
export const PREFERENCE_KEY_PREFIX = "pine.";
/** The light round the composer while the agent works. */
export const COMPOSER_GLOW_PREFERENCE_KEY = "pine.composer-glow";
/**
 * Preferences other windows apply as soon as they change. Everything else
 * (tab layouts and the like) is only read when a window opens, so it is
 * never broadcast.
 */
export const LIVE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  COMPOSER_GLOW_PREFERENCE_KEY,
]);
export const MAX_PREFERENCE_KEY_LENGTH = 256;
export const MAX_PREFERENCE_VALUE_LENGTH = 1_000_000;

export interface PinePreferencesApi {
  /** Everything stored, read once when the window's preload runs. */
  snapshot: Record<string, string>;
  set(key: string, value: string): void;
  remove(key: string): void;
  /**
   * Reports a preference another window set (a string) or removed (null).
   * Returns the unsubscribe.
   */
  onChange?(listener: (key: string, value: string | null) => void): () => void;
}

export interface PinePreferenceStorageApi {
  /**
   * UI preferences kept by the main process, so they survive a change of the
   * renderer's origin (a dev server on another port) and a cleared web cache.
   */
  preferences?: PinePreferencesApi;
}
