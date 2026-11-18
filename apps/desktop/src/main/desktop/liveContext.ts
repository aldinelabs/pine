import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import {
  LIVE_CONTEXT_EVENT_CHANNEL,
  LIVE_CONTEXT_PAUSE_CHANNEL,
  LIVE_CONTEXT_RESUME_CHANNEL,
  LIVE_CONTEXT_SOURCES,
  LIVE_CONTEXT_START_CHANNEL,
  LIVE_CONTEXT_STATUS_CHANNEL,
  LIVE_CONTEXT_STOP_CHANNEL,
  LIVE_CONTEXT_TRANSCRIPT_CHANNEL,
  type LiveContextEvent,
  type LiveContextUnavailableReason,
} from "../../shared/liveContext";
import { LiveContextService } from "../liveContext";

/** While experimental, Live Context only exists with this set to 1. */
export const LIVE_CONTEXT_FLAG = "PINE_EXPERIMENTAL_LIVE_CONTEXT";

/** Packaged apps carry it in Resources; dev runs use the build folder. */
function helperPath(): string | undefined {
  return [
    path.join(process.resourcesPath, "pine-live-context"),
    path.join(app.getAppPath(), "native/live-context/build/pine-live-context"),
  ].find((candidate) => existsSync(candidate));
}

function unavailableReason(): LiveContextUnavailableReason | null {
  if (process.env[LIVE_CONTEXT_FLAG] !== "1") return "disabled";
  if (process.platform !== "darwin") return "platform";
  const major = Number.parseInt(process.getSystemVersion(), 10);
  if (!(major >= 26)) return "platform";
  return helperPath() ? null : "helper-missing";
}

function broadcast(event: LiveContextEvent): void {
  for (const window of BrowserWindow.getAllWindows())
    if (!window.isDestroyed())
      window.webContents.send(LIVE_CONTEXT_EVENT_CHANNEL, event);
}

const targetSchema = z.object({
  projectId: z.uuid(),
  sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});
const startSchema = targetSchema.extend({
  sources: z.array(z.enum(LIVE_CONTEXT_SOURCES)).min(1).max(2),
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .max(35),
});

/**
 * Registered on `ipcMain` itself, never on the shared router: only this
 * Mac's windows may listen, never the browser interface or a paired phone.
 */
export function createLiveContext(options: {
  projectRoot(projectId: string): string;
}): LiveContextService {
  const service = new LiveContextService({
    unavailableReason,
    spawnHelper: () => {
      const file = helperPath();
      if (!file) throw new Error("The Live Context helper is missing.");
      // A child of Pine, so macOS asks for microphone and system audio
      // access on Pine's behalf and lists Pine in Privacy & Security.
      return spawn(file, [], { stdio: ["pipe", "pipe", "pipe"] });
    },
    projectRoot: (projectId) => options.projectRoot(projectId),
    emit: broadcast,
  });
  ipcMain.handle(LIVE_CONTEXT_STATUS_CHANNEL, () => service.status());
  ipcMain.handle(LIVE_CONTEXT_START_CHANNEL, (_event, request: unknown) =>
    service.start(startSchema.parse(request)),
  );
  ipcMain.handle(LIVE_CONTEXT_PAUSE_CHANNEL, () => service.pause());
  ipcMain.handle(LIVE_CONTEXT_RESUME_CHANNEL, () => service.resume());
  ipcMain.handle(LIVE_CONTEXT_STOP_CHANNEL, () => service.stop());
  ipcMain.handle(LIVE_CONTEXT_TRANSCRIPT_CHANNEL, (_event, request: unknown) =>
    service.transcript(targetSchema.parse(request)),
  );
  return service;
}
