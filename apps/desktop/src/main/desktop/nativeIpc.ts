import { randomUUID } from "node:crypto";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";
import {
  OPEN_ATTACHMENT_CHANNEL,
  PICK_ATTACHMENT_FOLDERS_CHANNEL,
  PICK_ATTACHMENTS_CHANNEL,
  type OpenAttachmentResult,
  type PickAttachmentsResult,
} from "../../shared/attachments";
import { OPEN_PROVIDER_AUTH_URL_CHANNEL } from "../../shared/models";
import { START_PROJECT_FILE_DRAG_CHANNEL } from "../../shared/projectFiles";
import {
  PICK_PROJECT_FOLDERS_CHANNEL,
  type PickProjectFoldersResult,
} from "../../shared/projects";
import {
  EXPORT_SESSION_CHANNEL,
  type ExportSessionResult,
} from "../../shared/sessions";
import { OPEN_EXTERNAL_URL_CHANNEL } from "../../shared/window";
import { WORKBENCH_STATE_RESPONSE_CHANNEL } from "../../shared/workbench";
import type { PineCore } from "../core/pineCore";
import { inspectAttachmentPaths } from "../core/requests/files";
import { ProjectSessionRequestSchema } from "../core/requestSchemas";
import { ProjectEntryReferenceSchema } from "../projectFileOperations";
import { startProjectFileDrag } from "../projectFileDrag";
import type { QuickComposerController } from "../quickComposer";

const PickProjectFoldersRequestSchema = z.object({
  mode: z.enum(["context", "default"]),
});
const ExternalUrlSchema = z.url().refine((url) => {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
});
const OpenAttachmentRequestSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4_096)
    .refine((attachmentPath) => path.isAbsolute(attachmentPath)),
});

type IpcListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/**
 * IPC that only a desktop window can make: native dialogs, the system
 * browser and file manager, and native drags. The browser interface has its
 * own equivalents in the page.
 */
export function registerNativeIpc(
  core: PineCore,
  quickComposer: QuickComposerController,
): void {
  /** Traces handlers that block on the user, like the shared requests. */
  function handleTraced(channel: string, listener: IpcListener): void {
    ipcMain.handle(channel, (event, ...args) =>
      core.diagnostics.trace(channel, event.sender.id, () =>
        listener(event, ...args),
      ),
    );
  }

  async function pickAttachments(
    event: IpcMainInvokeEvent,
    options: OpenDialogOptions,
  ): Promise<PickAttachmentsResult> {
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const selection = await quickComposer.whileModal(
      event.sender,
      parentWindow
        ? dialog.showOpenDialog(parentWindow, options)
        : dialog.showOpenDialog(options),
    );
    if (selection.canceled) return { attachments: [] };
    const result = await inspectAttachmentPaths(selection.filePaths);
    core.rememberAttachments(
      event.sender.id,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  }

  ipcMain.on(WORKBENCH_STATE_RESPONSE_CHANNEL, (event, response: unknown) => {
    core.workbenchStateRequests.respond(event.sender.id, response);
  });

  ipcMain.handle(OPEN_EXTERNAL_URL_CHANNEL, async (_event, url: unknown) => {
    await shell.openExternal(ExternalUrlSchema.parse(url));
  });

  ipcMain.handle(
    OPEN_PROVIDER_AUTH_URL_CHANNEL,
    async (_event, url: unknown) => {
      await shell.openExternal(ExternalUrlSchema.parse(url));
    },
  );

  ipcMain.handle(PICK_ATTACHMENTS_CHANNEL, (event) =>
    pickAttachments(event, {
      title: "Add Attachments",
      buttonLabel: "Add",
      properties: ["openFile", "multiSelections"],
    }),
  );

  handleTraced(PICK_ATTACHMENT_FOLDERS_CHANNEL, (event) =>
    pickAttachments(event, {
      title: "Add Attachment Folders",
      buttonLabel: "Add",
      properties: ["openDirectory", "multiSelections"],
    }),
  );

  ipcMain.handle(
    OPEN_ATTACHMENT_CHANNEL,
    async (_event, request: unknown): Promise<OpenAttachmentResult> => {
      const { path: attachmentPath } =
        OpenAttachmentRequestSchema.parse(request);
      const metadata = await stat(attachmentPath);
      if (!metadata.isFile() && !metadata.isDirectory()) {
        return { opened: false, error: "Attachment is not a file or folder." };
      }
      const error = await shell.openPath(attachmentPath);
      return error ? { opened: false, error } : { opened: true };
    },
  );

  handleTraced(
    PICK_PROJECT_FOLDERS_CHANNEL,
    async (event, request: unknown): Promise<PickProjectFoldersResult> => {
      const { mode } = PickProjectFoldersRequestSchema.parse(request);
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      const options: OpenDialogOptions = {
        title:
          mode === "default" ? "Choose Default Folder" : "Add Context Folders",
        buttonLabel: mode === "default" ? "Choose" : "Add",
        properties: [
          "openDirectory",
          ...(mode === "context" ? (["multiSelections"] as const) : []),
          "createDirectory",
          "promptToCreate",
        ],
      };
      const selection = parentWindow
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);

      if (selection.canceled) return { folders: [] };
      return {
        folders: selection.filePaths.map((folderPath) => ({
          access: "read-write",
          id: randomUUID(),
          name: path.basename(folderPath),
          path: folderPath,
        })),
      };
    },
  );

  ipcMain.handle(
    EXPORT_SESSION_CHANNEL,
    async (event, request: unknown): Promise<ExportSessionResult> => {
      const { projectId, sessionId } =
        ProjectSessionRequestSchema.parse(request);
      const document = await core.runtimes.exportSession(
        event.sender.id,
        projectId,
        sessionId,
      );
      const parentWindow = BrowserWindow.fromWebContents(event.sender);
      if (!parentWindow) return { saved: false };
      const result = await dialog.showSaveDialog(parentWindow, {
        defaultPath: document.fileName,
        filters: [{ name: "Markdown", extensions: ["md"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (result.canceled || !result.filePath) return { saved: false };

      await writeFile(result.filePath, document.markdown, "utf8");
      return { path: result.filePath, saved: true };
    },
  );

  async function handleProjectFileDrag(
    event: IpcMainEvent,
    request: unknown,
  ): Promise<void> {
    try {
      const entry = ProjectEntryReferenceSchema.parse(request);
      const filePath = core.runtimes.projectEntryPathForNativeDrag(
        event.sender.id,
        entry,
      );
      await startProjectFileDrag(event.sender, filePath, (file, options) =>
        app.getFileIcon(file, options),
      );
    } catch (error) {
      console.error("Failed to start project file drag.", error);
    }
  }

  ipcMain.on(
    START_PROJECT_FILE_DRAG_CHANNEL,
    (event, request: unknown): void => {
      void handleProjectFileDrag(event, request);
    },
  );
}
