export const GET_REMOTE_CONTROL_CHANNEL = "remote-control:get";
export const SET_REMOTE_CONTROL_ENABLED_CHANNEL = "remote-control:set-enabled";
export const START_REMOTE_PAIRING_CHANNEL = "remote-control:start-pairing";
export const CANCEL_REMOTE_PAIRING_CHANNEL = "remote-control:cancel-pairing";
export const RENAME_REMOTE_DEVICE_CHANNEL = "remote-control:rename-device";
export const REMOVE_REMOTE_DEVICE_CHANNEL = "remote-control:remove-device";
export const REMOTE_CONTROL_CHANGED_CHANNEL = "remote-control:changed";
export const MAX_REMOTE_DEVICE_NAME_LENGTH = 100;

export interface RemoteDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt?: number;
  online: boolean;
}

/** What the settings page shows about devices that control this computer. */
export interface RemoteStatus {
  enabled: boolean;
  /** Present while a QR code is waiting to be scanned. */
  pairing?: { url: string; expiresAt: number; fingerprint: string };
  devices: RemoteDevice[];
  /** Devices reach Pine through the local web server, so it must be running. */
  webAccessOn: boolean;
}

export interface RenameRemoteDeviceRequest {
  id: string;
  name: string;
}

export const DEFAULT_REMOTE_STATUS: RemoteStatus = {
  enabled: false,
  devices: [],
  webAccessOn: false,
};
