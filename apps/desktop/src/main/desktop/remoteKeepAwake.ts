import { BrowserWindow, ipcMain, powerSaveBlocker } from "electron";
import { z } from "zod";
import {
  GET_REMOTE_KEEP_AWAKE_CHANNEL,
  REMOTE_KEEP_AWAKE_CHANGED_CHANNEL,
  SET_REMOTE_KEEP_AWAKE_CHANNEL,
  type RemoteKeepAwakeStatus,
} from "../../shared/remoteKeepAwake";
import type { RemoteKeepAwake } from "../remoteKeepAwake";

/**
 * Keeps the system from sleeping while asked to (`on`). Repeated calls with
 * the same value do nothing; the display may still turn off.
 */
export function createPowerBlocker(): (on: boolean) => void {
  let blocker: number | undefined;
  return (on) => {
    if (on) {
      if (blocker !== undefined && powerSaveBlocker.isStarted(blocker)) return;
      blocker = powerSaveBlocker.start("prevent-app-suspension");
      return;
    }
    if (blocker === undefined) return;
    if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = undefined;
  };
}

/**
 * Registered on `ipcMain` itself, never on the shared router, so neither the
 * browser interface nor a paired phone can read or change the setting.
 */
export function registerRemoteKeepAwakeIpc(options: {
  controller: Pick<RemoteKeepAwake, "status">;
  set(enabled: boolean): Promise<RemoteKeepAwakeStatus>;
}): void {
  ipcMain.handle(GET_REMOTE_KEEP_AWAKE_CHANNEL, () =>
    options.controller.status(),
  );
  ipcMain.handle(SET_REMOTE_KEEP_AWAKE_CHANNEL, (_event, request: unknown) =>
    options.set(z.boolean().parse(request)),
  );
}

export function broadcastRemoteKeepAwake(status: RemoteKeepAwakeStatus): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(REMOTE_KEEP_AWAKE_CHANGED_CHANNEL, status);
}
