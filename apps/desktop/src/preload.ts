import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createPineApi } from "./client/pineApi";
import type { PineDesktopApi } from "./shared/projects";
import {
  GET_RUN_IN_BACKGROUND_CHANNEL,
  SET_RUN_IN_BACKGROUND_CHANNEL,
} from "./shared/background";
import {
  PREFERENCES_CHANGED_CHANNEL,
  PREFERENCES_REMOVE_CHANNEL,
  PREFERENCES_SET_CHANNEL,
  PREFERENCES_SNAPSHOT_CHANNEL,
} from "./shared/preferenceStorage";
import {
  GET_PI_PROVIDERS_CHANNEL,
  PICK_PI_AGENT_DIR_CHANNEL,
  REVEAL_PI_PROVIDERS_CHANNEL,
  SET_PI_PROVIDERS_CHANNEL,
} from "./shared/piProviders";
import {
  LIVE_CONTEXT_EVENT_CHANNEL,
  LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL,
  LIVE_CONTEXT_PAUSE_CHANNEL,
  LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL,
  LIVE_CONTEXT_RESUME_CHANNEL,
  LIVE_CONTEXT_START_CHANNEL,
  LIVE_CONTEXT_DELETE_CHANNEL,
  LIVE_CONTEXT_CREATE_SESSION_CHANNEL,
  LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL,
  LIVE_CONTEXT_STATUS_CHANNEL,
  LIVE_CONTEXT_STOP_CHANNEL,
  LIVE_CONTEXT_SKIP_SPEAKERS_CHANNEL,
  LIVE_CONTEXT_TRANSCRIPT_CHANNEL,
  type LiveContextEvent,
} from "./shared/liveContext";
import { QUICK_COMPOSER_HANDOFF_ARGUMENT } from "./shared/quickComposer";
import {
  GET_REMOTE_KEEP_AWAKE_CHANNEL,
  REMOTE_KEEP_AWAKE_CHANGED_CHANNEL,
  SET_REMOTE_KEEP_AWAKE_CHANNEL,
  type RemoteKeepAwakeStatus,
} from "./shared/remoteKeepAwake";
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
    onChange: (listener) => {
      const handler = (_event: unknown, key: string, value: string | null) =>
        listener(key, value);
      ipcRenderer.on(PREFERENCES_CHANGED_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(PREFERENCES_CHANGED_CHANNEL, handler);
    },
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
  getPiProviders: () => ipcRenderer.invoke(GET_PI_PROVIDERS_CHANNEL),
  setPiProviders: (request) =>
    ipcRenderer.invoke(SET_PI_PROVIDERS_CHANNEL, request),
  revealPiProviders: () => ipcRenderer.invoke(REVEAL_PI_PROVIDERS_CHANNEL),
  pickPiAgentDir: () => ipcRenderer.invoke(PICK_PI_AGENT_DIR_CHANNEL),
  liveContext: {
    status: () => ipcRenderer.invoke(LIVE_CONTEXT_STATUS_CHANNEL),
    start: (request) => ipcRenderer.invoke(LIVE_CONTEXT_START_CHANNEL, request),
    pause: () => ipcRenderer.invoke(LIVE_CONTEXT_PAUSE_CHANNEL),
    resume: () => ipcRenderer.invoke(LIVE_CONTEXT_RESUME_CHANNEL),
    stop: () => ipcRenderer.invoke(LIVE_CONTEXT_STOP_CHANNEL),
    skipSpeakers: () => ipcRenderer.invoke(LIVE_CONTEXT_SKIP_SPEAKERS_CHANNEL),
    transcript: (target) =>
      ipcRenderer.invoke(LIVE_CONTEXT_TRANSCRIPT_CHANNEL, target),
    renameSpeaker: (request) =>
      ipcRenderer.invoke(LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL, request),
    mergeSpeakers: (request) =>
      ipcRenderer.invoke(LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL, request),
    deleteTranscript: (target) =>
      ipcRenderer.invoke(LIVE_CONTEXT_DELETE_CHANNEL, target),
    createSession: (request) =>
      ipcRenderer.invoke(LIVE_CONTEXT_CREATE_SESSION_CHANNEL, request),
    openPrivacySettings: (source) =>
      ipcRenderer.invoke(LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL, source),
    subscribe: (listener) => {
      const handler = (_event: unknown, event: LiveContextEvent) =>
        listener(event);
      ipcRenderer.on(LIVE_CONTEXT_EVENT_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(LIVE_CONTEXT_EVENT_CHANNEL, handler);
    },
  },
  getRemoteKeepAwake: () => ipcRenderer.invoke(GET_REMOTE_KEEP_AWAKE_CHANNEL),
  setRemoteKeepAwake: (enabled) =>
    ipcRenderer.invoke(SET_REMOTE_KEEP_AWAKE_CHANNEL, enabled),
  onRemoteKeepAwakeChanged: (listener) => {
    const handler = (_event: unknown, status: RemoteKeepAwakeStatus) =>
      listener(status);
    ipcRenderer.on(REMOTE_KEEP_AWAKE_CHANGED_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(REMOTE_KEEP_AWAKE_CHANGED_CHANNEL, handler);
  },
};
contextBridge.exposeInMainWorld("pine", pineApi);

declare global {
  interface Window {
    pine: PineDesktopApi;
  }
}
