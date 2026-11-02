import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createPineApi } from "./client/pineApi";
import type { PineDesktopApi } from "./shared/projects";
import { QUICK_COMPOSER_HANDOFF_ARGUMENT } from "./shared/quickComposer";
import {
  CANCEL_REMOTE_PAIRING_CHANNEL,
  GET_REMOTE_CONTROL_CHANNEL,
  REMOTE_CONTROL_CHANGED_CHANNEL,
  REMOVE_REMOTE_DEVICE_CHANNEL,
  RENAME_REMOTE_DEVICE_CHANNEL,
  SET_REMOTE_CONTROL_ENABLED_CHANNEL,
  START_REMOTE_PAIRING_CHANNEL,
  type RemoteStatus,
} from "./shared/remoteControl";
import {
  GET_WEB_SERVER_CHANNEL,
  SET_WEB_PASSWORD_CHANNEL,
  SIGN_OUT_WEB_BROWSERS_CHANNEL,
  SET_WEB_SERVER_CHANNEL,
} from "./shared/webControl";

const pineApi: PineDesktopApi = {
  ...createPineApi({
    platform: process.platform,
    isQuickComposerHandoff: process.argv.includes(
      QUICK_COMPOSER_HANDOFF_ARGUMENT,
    ),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    invoke: <T>(channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(channel, ...args) as Promise<T>,
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, listener) => {
      ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
      ipcRenderer.removeListener(channel, listener);
    },
  }),
  runtime: "desktop",
  getWebServer: () => ipcRenderer.invoke(GET_WEB_SERVER_CHANNEL),
  setWebPassword: (password) =>
    ipcRenderer.invoke(SET_WEB_PASSWORD_CHANNEL, password),
  signOutWebBrowsers: () => ipcRenderer.invoke(SIGN_OUT_WEB_BROWSERS_CHANNEL),
  setWebServer: (request) =>
    ipcRenderer.invoke(SET_WEB_SERVER_CHANNEL, request),
  getRemoteControl: () => ipcRenderer.invoke(GET_REMOTE_CONTROL_CHANNEL),
  setRemoteControlEnabled: (enabled) =>
    ipcRenderer.invoke(SET_REMOTE_CONTROL_ENABLED_CHANNEL, enabled),
  startRemotePairing: () => ipcRenderer.invoke(START_REMOTE_PAIRING_CHANNEL),
  cancelRemotePairing: () => ipcRenderer.invoke(CANCEL_REMOTE_PAIRING_CHANNEL),
  renameRemoteDevice: (request) =>
    ipcRenderer.invoke(RENAME_REMOTE_DEVICE_CHANNEL, request),
  removeRemoteDevice: (id) =>
    ipcRenderer.invoke(REMOVE_REMOTE_DEVICE_CHANNEL, id),
  onRemoteControlChanged: (listener) => {
    const handler = (_event: unknown, status: RemoteStatus) => listener(status);
    ipcRenderer.on(REMOTE_CONTROL_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(REMOTE_CONTROL_CHANGED_CHANNEL, handler);
  },
};
contextBridge.exposeInMainWorld("pine", pineApi);

declare global {
  interface Window {
    pine: PineDesktopApi;
  }
}
