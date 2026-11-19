export const GET_COMPUTER_USE_ENABLED_CHANNEL =
  "preferences:get-computer-use-enabled" as const;
export const SET_COMPUTER_USE_ENABLED_CHANNEL =
  "preferences:set-computer-use-enabled" as const;
/** Settings › Agent › Computer use; absent from the settings file means on. */
export const DEFAULT_COMPUTER_USE_ENABLED = true;

export interface SetComputerUseEnabledRequest {
  enabled: boolean;
}

export interface SetComputerUseEnabledResult {
  enabled: boolean;
}
