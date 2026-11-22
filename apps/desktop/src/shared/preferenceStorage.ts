export const PREFERENCES_SNAPSHOT_CHANNEL = "preferences:snapshot" as const;
export const PREFERENCES_SET_CHANNEL = "preferences:set" as const;
export const PREFERENCES_REMOVE_CHANNEL = "preferences:remove" as const;
/** Whether this window may adopt web storage left by an earlier build. */
export const PREFERENCES_ADOPT_WEB_STORAGE_CHANNEL =
  "preferences:adopt-web-storage" as const;
/** Main → renderer: another window changed a preference. */
export const PREFERENCES_CHANGED_CHANNEL = "preferences:changed" as const;

/** Renderer UI preferences all live under this key prefix. */
export const PREFERENCE_KEY_PREFIX = "pine.";
/** The currency costs are shown in; absent means "follow the system". */
export const CURRENCY_PREFERENCE_KEY = "pine.currency";
/** The light round the composer while the agent works. */
export const COMPOSER_GLOW_PREFERENCE_KEY = "pine.composer-glow";
/** The composer suggesting a reply after the agent answers. */
export const REPLY_SUGGESTIONS_PREFERENCE_KEY =
  "pine.composer-reply-suggestions";
/** The buttons that open Pine's illustrated guides. */
export const HELP_GUIDES_PREFERENCE_KEY = "pine.help-guides";
/** The one-time hints the user has already dismissed. */
export const FIRST_USE_HINTS_PREFERENCE_KEY = "pine.first-use-hints.v1";
/**
 * Preferences other windows apply as soon as they change. Everything else
 * (tab layouts and the like) is only read when a window opens, so it is
 * never broadcast.
 */
export const LIVE_PREFERENCE_KEYS: ReadonlySet<string> = new Set([
  COMPOSER_GLOW_PREFERENCE_KEY,
  REPLY_SUGGESTIONS_PREFERENCE_KEY,
  HELP_GUIDES_PREFERENCE_KEY,
  FIRST_USE_HINTS_PREFERENCE_KEY,
]);
export const MAX_PREFERENCE_KEY_LENGTH = 256;
export const MAX_PREFERENCE_VALUE_LENGTH = 1_000_000;

export interface PinePreferencesApi {
  /** Everything stored, read once when the window's preload runs. */
  snapshot: Record<string, string>;
  set(key: string, value: string): void;
  remove(key: string): void;
  /**
   * False when this window must not adopt web storage from an earlier build:
   * web storage is shared by every Pine user, and only the primary user's
   * preferences ever lived there.
   */
  adoptWebStorage?: boolean;
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
