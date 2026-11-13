export const GET_REMOTE_KEEP_AWAKE_CHANNEL = "remote-keep-awake:get" as const;
export const SET_REMOTE_KEEP_AWAKE_CHANNEL = "remote-keep-awake:set" as const;
export const REMOTE_KEEP_AWAKE_CHANGED_CHANNEL =
  "remote-keep-awake:changed" as const;

/** Desktop IPC only; never on the shared router, so browsers and phones cannot reach them. */
export const REMOTE_KEEP_AWAKE_REQUEST_CHANNELS = [
  GET_REMOTE_KEEP_AWAKE_CHANNEL,
  SET_REMOTE_KEEP_AWAKE_CHANNEL,
] as const;

/** "Keep the computer awake while remote control is on" is off by default. */
export const DEFAULT_REMOTE_KEEP_AWAKE = false;

export interface RemoteKeepAwakeStatus {
  /** The setting itself. */
  enabled: boolean;
  /** Some remote access is on right now (Browser access, or WeChat receiving tasks). */
  remoteOn: boolean;
}

export const DEFAULT_REMOTE_KEEP_AWAKE_STATUS: RemoteKeepAwakeStatus = {
  enabled: DEFAULT_REMOTE_KEEP_AWAKE,
  remoteOn: false,
};

export interface PineRemoteKeepAwakeApi {
  getRemoteKeepAwake?: () => Promise<RemoteKeepAwakeStatus>;
  /** Resolves to what is now applied. */
  setRemoteKeepAwake?: (enabled: boolean) => Promise<RemoteKeepAwakeStatus>;
  onRemoteKeepAwakeChanged?: (
    listener: (status: RemoteKeepAwakeStatus) => void,
  ) => () => void;
}
