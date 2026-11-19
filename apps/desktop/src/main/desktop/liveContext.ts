import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, net, shell } from "electron";
import { z } from "zod";
import {
  LIVE_CONTEXT_EVENT_CHANNEL,
  LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL,
  LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL,
  LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL,
  LIVE_CONTEXT_PAUSE_CHANNEL,
  LIVE_CONTEXT_RESUME_CHANNEL,
  LIVE_CONTEXT_SOURCES,
  LIVE_CONTEXT_START_CHANNEL,
  LIVE_CONTEXT_CREATE_SESSION_CHANNEL,
  LIVE_CONTEXT_STATUS_CHANNEL,
  LIVE_CONTEXT_STOP_CHANNEL,
  LIVE_CONTEXT_TRANSCRIPT_CHANNEL,
  type LiveContextEvent,
  type LiveContextUnavailableReason,
} from "../../shared/liveContext";
import {
  LIVE_CONTEXT_SPEAKER_KEY,
  LIVE_CONTEXT_SPEAKER_NAME_MAX,
} from "../../shared/liveContextSpeakers";
import type { PineApprovalMode } from "../../shared/agent";
import type { PineSessionSummary } from "../../shared/sessions";
import { LiveContextService } from "../liveContext";
import { ensureSpeakerModels } from "../liveContextSpeakerModels";

/** Packaged apps carry it in Resources; dev runs use the build folder. */
function helperPath(): string | undefined {
  return [
    path.join(process.resourcesPath, "pine-live-context"),
    path.join(app.getAppPath(), "native/live-context/build/pine-live-context"),
  ].find((candidate) => existsSync(candidate));
}

/** sherpa-onnx ships beside the helper (see scripts/build-native.mjs). */
function speakerLibraryExists(): boolean {
  const helper = helperPath();
  return Boolean(
    helper &&
    existsSync(
      path.join(
        path.dirname(helper),
        "live-context-lib/libsherpa-onnx-c-api.dylib",
      ),
    ),
  );
}

/** Unpacks one file of a checked .tar.bz2 archive with the system's tar. */
async function extractMember(
  archive: string,
  member: string,
  destination: string,
): Promise<void> {
  const folder = await mkdtemp(path.join(path.dirname(destination), ".tar-"));
  try {
    await promisify(execFile)("/usr/bin/tar", [
      "-xjf",
      archive,
      "-C",
      folder,
      member,
    ]);
    await rename(path.join(folder, member), destination);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function unavailableReason(): LiveContextUnavailableReason | null {
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
  speakers: z.boolean().optional(),
});
const createSessionSchema = z.object({
  projectId: z.uuid(),
  approvalMode: z
    .enum(["let-me-review", "auto-approve", "autonomous", "YOLO"])
    .optional(),
});
const speakerKeySchema = z
  .string()
  .regex(LIVE_CONTEXT_SPEAKER_KEY)
  .transform((key) => key as `${"mic" | "system"}-${number}`);
const renameSchema = targetSchema.extend({
  speaker: speakerKeySchema,
  name: z.string().max(LIVE_CONTEXT_SPEAKER_NAME_MAX * 4),
});
const mergeSchema = targetSchema.extend({
  from: speakerKeySchema,
  into: speakerKeySchema,
});

/**
 * Registered on `ipcMain` itself, never on the shared router: only this
 * Mac's windows may listen, never the browser interface or a paired phone.
 */
export function createLiveContext(options: {
  projectRoot(projectId: string): string;
  /** Starts an empty session for the window to capture into. */
  createSession(
    clientId: number,
    projectId: string,
    approvalMode?: PineApprovalMode,
  ): Promise<PineSessionSummary>;
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
    speakers: {
      available: speakerLibraryExists,
      // Downloaded once into Pine's data folder, through the system proxy
      // like Pine's other requests, and checked against pinned hashes.
      models: (onProgress) =>
        ensureSpeakerModels({
          directory: path.join(
            app.getPath("userData"),
            "models",
            "live-context-speakers",
          ),
          fetch: (url) => net.fetch(url),
          extract: extractMember,
          onProgress,
        }),
    },
  });
  ipcMain.handle(LIVE_CONTEXT_STATUS_CHANNEL, () => service.status());
  ipcMain.handle(LIVE_CONTEXT_START_CHANNEL, (_event, request: unknown) =>
    service.start(startSchema.parse(request)),
  );
  ipcMain.handle(
    LIVE_CONTEXT_CREATE_SESSION_CHANNEL,
    (event, request: unknown) => {
      const { projectId, approvalMode } = createSessionSchema.parse(request);
      return options.createSession(event.sender.id, projectId, approvalMode);
    },
  );
  ipcMain.handle(LIVE_CONTEXT_PAUSE_CHANNEL, () => service.pause());
  ipcMain.handle(LIVE_CONTEXT_RESUME_CHANNEL, () => service.resume());
  ipcMain.handle(LIVE_CONTEXT_STOP_CHANNEL, () => service.stop());
  ipcMain.handle(LIVE_CONTEXT_TRANSCRIPT_CHANNEL, (_event, request: unknown) =>
    service.transcript(targetSchema.parse(request)),
  );
  ipcMain.handle(
    LIVE_CONTEXT_RENAME_SPEAKER_CHANNEL,
    (_event, request: unknown) =>
      service.renameSpeaker(renameSchema.parse(request)),
  );
  ipcMain.handle(
    LIVE_CONTEXT_MERGE_SPEAKERS_CHANNEL,
    (_event, request: unknown) =>
      service.mergeSpeakers(mergeSchema.parse(request)),
  );
  ipcMain.handle(
    LIVE_CONTEXT_OPEN_PRIVACY_SETTINGS_CHANNEL,
    async (_event, request: unknown): Promise<void> => {
      const source = z.enum(LIVE_CONTEXT_SOURCES).parse(request);
      await shell.openExternal(
        `x-apple.systempreferences:com.apple.preference.security?${
          source === "mic" ? "Privacy_Microphone" : "Privacy_ScreenCapture"
        }`,
      );
    },
  );
  return service;
}
