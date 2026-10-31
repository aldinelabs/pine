import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createPineApi } from "./client/pineApi";
import type { PineDesktopApi } from "./shared/projects";
import { QUICK_COMPOSER_HANDOFF_ARGUMENT } from "./shared/quickComposer";
import {
  GET_WEB_SERVER_CHANNEL,
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
  setWebServer: (request) =>
    ipcRenderer.invoke(SET_WEB_SERVER_CHANNEL, request),
};
contextBridge.exposeInMainWorld("pine", pineApi);

declare global {
  interface Window {
    pine: PineDesktopApi;
  }
}
