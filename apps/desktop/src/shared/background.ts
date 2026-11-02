export const GET_RUN_IN_BACKGROUND_CHANNEL =
  "preferences:get-run-in-background" as const;
export const SET_RUN_IN_BACKGROUND_CHANNEL =
  "preferences:set-run-in-background" as const;

/**
 * Closing the last window keeps Pine running in the menu bar or notification
 * area, so Remote Control and the quick composer stay reachable. On by
 * default; the quit guard still asks before Quit ends running work.
 */
export const DEFAULT_RUN_IN_BACKGROUND = true;

/** Platforms with a tray Pine can live in. */
export function supportsBackgroundMode(platform: string): boolean {
  return platform === "darwin" || platform === "win32";
}

export interface PineBackgroundApi {
  /** Whether closing the last window leaves Pine in the tray. */
  getRunInBackground?: () => Promise<boolean>;
  /** Resolves to what is now applied. */
  setRunInBackground?: (enabled: boolean) => Promise<boolean>;
}
