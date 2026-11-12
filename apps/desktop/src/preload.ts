import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createPineApi } from "./client/pineApi";
import type { PineDesktopApi } from "./shared/projects";
import {
  GET_RUN_IN_BACKGROUND_CHANNEL,
  SET_RUN_IN_BACKGROUND_CHANNEL,
} from "./shared/background";
import {
  PREFERENCES_REMOVE_CHANNEL,
  PREFERENCES_SET_CHANNEL,
  PREFERENCES_SNAPSHOT_CHANNEL,
} from "./shared/preferenceStorage";
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
import {
  CANCEL_WECHAT_BINDING_CHANNEL,
  GET_WECHAT_REMOTE_CHANNEL,
  SET_WECHAT_PAUSED_CHANNEL,
  SET_WECHAT_SETTINGS_CHANNEL,
  START_WECHAT_BINDING_CHANNEL,
  SUBMIT_WECHAT_PAIRING_CODE_CHANNEL,
  SUBMIT_WECHAT_VERIFY_CODE_CHANNEL,
  UNBIND_WECHAT_CHANNEL,
  WECHAT_REMOTE_CHANGED_CHANNEL,
  type WeChatStatus,
} from "./shared/wechatRemote";

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
  // Stores read their preferences while they are created, so the snapshot is
  // fetched synchronously before any renderer code runs.
  preferences: {
    snapshot: ipcRenderer.sendSync(PREFERENCES_SNAPSHOT_CHANNEL) as Record<
      string,
      string
    >,
    set: (key, value) => ipcRenderer.send(PREFERENCES_SET_CHANNEL, key, value),
    remove: (key) => ipcRenderer.send(PREFERENCES_REMOVE_CHANNEL, key),
  },
  getWebServer: () => ipcRenderer.invoke(GET_WEB_SERVER_CHANNEL),
  setWebPassword: (password) =>
    ipcRenderer.invoke(SET_WEB_PASSWORD_CHANNEL, password),
  signOutWebBrowsers: () => ipcRenderer.invoke(SIGN_OUT_WEB_BROWSERS_CHANNEL),
  setWebServer: (request) =>
    ipcRenderer.invoke(SET_WEB_SERVER_CHANNEL, request),
  getRunInBackground: () => ipcRenderer.invoke(GET_RUN_IN_BACKGROUND_CHANNEL),
  setRunInBackground: (enabled) =>
    ipcRenderer.invoke(SET_RUN_IN_BACKGROUND_CHANNEL, enabled),
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
  getWeChatRemote: () => ipcRenderer.invoke(GET_WECHAT_REMOTE_CHANNEL),
  setWeChatPaused: (paused) =>
    ipcRenderer.invoke(SET_WECHAT_PAUSED_CHANNEL, paused),
  startWeChatBinding: () => ipcRenderer.invoke(START_WECHAT_BINDING_CHANNEL),
  cancelWeChatBinding: () => ipcRenderer.invoke(CANCEL_WECHAT_BINDING_CHANNEL),
  submitWeChatVerifyCode: (code) =>
    ipcRenderer.invoke(SUBMIT_WECHAT_VERIFY_CODE_CHANNEL, code),
  submitWeChatPairingCode: (code) =>
    ipcRenderer.invoke(SUBMIT_WECHAT_PAIRING_CODE_CHANNEL, code),
  unbindWeChat: () => ipcRenderer.invoke(UNBIND_WECHAT_CHANNEL),
  setWeChatSettings: (patch) =>
    ipcRenderer.invoke(SET_WECHAT_SETTINGS_CHANNEL, patch),
  onWeChatRemoteChanged: (listener) => {
    const handler = (_event: unknown, status: WeChatStatus) => listener(status);
    ipcRenderer.on(WECHAT_REMOTE_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(WECHAT_REMOTE_CHANGED_CHANNEL, handler);
  },
};
contextBridge.exposeInMainWorld("pine", pineApi);

declare global {
  interface Window {
    pine: PineDesktopApi;
  }
}
