import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  INSPECT_ATTACHMENTS_CHANNEL,
  SAVE_PASTED_ATTACHMENT_CHANNEL,
  extensionForPastedImage,
  type PickAttachmentsResult,
  type PineAttachment,
  type PineAttachmentKind,
  type SavePastedAttachmentResult,
} from "../../../shared/attachments";
import {
  LIST_PROJECT_DIRECTORY_CHANNEL,
  PRESENTED_FILE_OPERATION_CHANNEL,
  PROJECT_FILE_ATTACHMENTS_CHANNEL,
  PROJECT_FILE_OPERATION_CHANNEL,
  READ_PRESENTED_FILE_PREVIEW_CHANNEL,
  READ_PROJECT_FILE_PREVIEW_CHANNEL,
  REOPEN_PRESENTED_TOOL_FILE_CHANNEL,
  SET_WATCHED_FILE_PREVIEW_CHANNEL,
  SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
  type ListProjectDirectoryResult,
} from "../../../shared/projectFiles";
import {
  SetWatchedFilePreviewRequestSchema,
  SetWatchedProjectDirectoriesRequestSchema,
} from "../../fileSubscriptionSchemas";
import { operatePresentedFile } from "../../presentedFiles";
import {
  ProjectEntryReferenceSchema,
  ProjectFileOperationSchema,
} from "../../projectFileOperations";
import {
  projectMediaUrl,
  readProjectFilePreview,
} from "../../projectFilePreview";
import type { PineCore } from "../pineCore";
import {
  InspectAttachmentsRequestSchema,
  ListProjectDirectoryRequestSchema,
  PresentedFilePreviewRequestSchema,
  ProjectFilePreviewRequestSchema,
  ReopenPresentedToolFileRequestSchema,
  SavePastedAttachmentRequestSchema,
} from "../requestSchemas";

export async function inspectAttachmentPaths(
  filePaths: readonly string[],
): Promise<PickAttachmentsResult> {
  const attachments = await Promise.all(
    filePaths.map(async (filePath): Promise<PineAttachment | undefined> => {
      const metadata = await stat(filePath);
      let kind: PineAttachmentKind;
      if (metadata.isFile()) kind = "file";
      else if (metadata.isDirectory()) kind = "directory";
      else return undefined;
      return {
        extension:
          kind === "file" ? path.extname(filePath).slice(1).toLowerCase() : "",
        kind,
        modifiedAt: metadata.mtime.toISOString(),
        name: path.basename(filePath),
        path: filePath,
        size: metadata.size,
      };
    }),
  );
  return {
    attachments: attachments.filter((attachment) => attachment !== undefined),
  };
}

/** Project files, presented files and message attachments. */
export function registerFileRequests(core: PineCore): void {
  const { runtimes } = core;

  /** Inspects attachments and grants their previews to the client. */
  async function shareAttachments(
    clientId: number,
    filePaths: readonly string[],
  ): Promise<PickAttachmentsResult> {
    const result = await inspectAttachmentPaths(filePaths);
    core.rememberAttachments(
      clientId,
      result.attachments.map((attachment) => attachment.path),
    );
    return result;
  }

  core.handle(READ_PROJECT_FILE_PREVIEW_CHANNEL, async (context, request) => {
    const entry = ProjectFilePreviewRequestSchema.parse(request);
    const filePath = await core.previewPath(context.clientId, entry);
    return readProjectFilePreview(
      filePath,
      projectMediaUrl(context.clientId, entry, {
        web: context.source === "web",
      }),
    );
  });

  core.handle(
    SET_WATCHED_FILE_PREVIEW_CHANNEL,
    (context, request: unknown): Promise<void> => {
      const parsed = SetWatchedFilePreviewRequestSchema.parse(request);
      return core.filePreviewWatchers.setWatchedPreview(
        context.clientId,
        parsed,
      );
    },
  );

  core.handle(READ_PRESENTED_FILE_PREVIEW_CHANNEL, async (context, request) => {
    const entry = PresentedFilePreviewRequestSchema.parse(request);
    // Presented files live outside every project folder, so the tab reads them
    // through the client-scoped grant instead of a project entry.
    const filePath = await core.presentedFilePath(context.clientId, entry);
    return readProjectFilePreview(
      filePath,
      projectMediaUrl(
        context.clientId,
        { path: filePath },
        { presented: true, web: context.source === "web" },
      ),
    );
  });

  core.handle(REOPEN_PRESENTED_TOOL_FILE_CHANNEL, async (context, request) => {
    const { projectId, sessionId, toolCallId } =
      ReopenPresentedToolFileRequestSchema.parse(request);
    const target = await runtimes.reopenPresentedToolFile(
      context.clientId,
      projectId,
      sessionId,
      toolCallId,
    );
    if (target?.source === "presented")
      core.presentedFiles.remember(context.clientId, target.path);
    return target;
  });

  core.handle(
    INSPECT_ATTACHMENTS_CHANNEL,
    async (context, request: unknown): Promise<PickAttachmentsResult> => {
      const { paths } = InspectAttachmentsRequestSchema.parse(request);
      return shareAttachments(context.clientId, paths);
    },
  );

  core.handle(
    SAVE_PASTED_ATTACHMENT_CHANNEL,
    async (context, request: unknown): Promise<SavePastedAttachmentResult> => {
      const parsed = SavePastedAttachmentRequestSchema.parse(request);
      let attachmentsRoot = runtimes.attachmentsRootFor(
        context.clientId,
        parsed.projectId,
      );
      if (
        !attachmentsRoot &&
        context.source === "desktop" &&
        core.host.isQuickComposerClient?.(context.clientId)
      ) {
        // The panel never owns a runtime. Validate the selected project before
        // using its Pine-managed attachment storage.
        await core.repository.get(parsed.projectId);
        attachmentsRoot = core.repository.dataPaths(
          parsed.projectId,
        ).attachmentsRoot;
      }
      if (!attachmentsRoot) {
        throw new Error("The project is not open in this window.");
      }

      const isText = parsed.mimeType === "text/plain";
      const extension = isText
        ? "txt"
        : extensionForPastedImage(parsed.mimeType);
      const displayName =
        path
          .basename(parsed.name ?? "")
          .trim()
          .slice(0, 200) || (isText ? "pasted-text.txt" : `image.${extension}`);

      await mkdir(attachmentsRoot, { recursive: true });
      const attachmentPath = path.join(
        attachmentsRoot,
        `${randomUUID()}.${extension}`,
      );
      await writeFile(attachmentPath, isText ? parsed.text : parsed.bytes);
      const metadata = await stat(attachmentPath);

      const attachment: PineAttachment = {
        extension,
        kind: "file",
        modifiedAt: metadata.mtime.toISOString(),
        name: displayName,
        path: attachmentPath,
        size: metadata.size,
      };
      core.rememberAttachments(context.clientId, [attachmentPath]);
      return { attachment };
    },
  );

  // Serialize filesystem operations so concurrent drags cannot overwrite one another.
  let projectFileOperationQueue: Promise<void> = Promise.resolve();
  core.handle(PROJECT_FILE_OPERATION_CHANNEL, (context, request: unknown) => {
    const operation = ProjectFileOperationSchema.parse(request);
    const pending = projectFileOperationQueue.then(() =>
      runtimes.operateFile(context.clientId, operation, core.host.fileActions),
    );
    projectFileOperationQueue = pending.catch(() => undefined);
    return pending;
  });

  core.handle(
    PRESENTED_FILE_OPERATION_CHANNEL,
    (context, request: unknown): Promise<void> =>
      operatePresentedFile(
        request,
        (filePath) =>
          core.presentedFilePath(context.clientId, { path: filePath }),
        core.host.fileActions,
      ),
  );

  core.handle(
    PROJECT_FILE_ATTACHMENTS_CHANNEL,
    async (context, request: unknown): Promise<PickAttachmentsResult> => {
      const entries = z
        .array(ProjectEntryReferenceSchema)
        .min(1)
        .max(100)
        .parse(request);
      const paths = await runtimes.projectEntryPaths(context.clientId, entries);
      return shareAttachments(context.clientId, paths);
    },
  );

  core.handle(
    LIST_PROJECT_DIRECTORY_CHANNEL,
    async (context, request: unknown): Promise<ListProjectDirectoryResult> => {
      const { folderId, projectId, relativePath } =
        ListProjectDirectoryRequestSchema.parse(request);
      return {
        entries: await runtimes.listDirectory(
          context.clientId,
          projectId,
          folderId,
          relativePath,
        ),
      };
    },
  );

  core.handle(
    SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL,
    (context, request: unknown): Promise<void> => {
      const parsed = SetWatchedProjectDirectoriesRequestSchema.parse(request);
      return core
        .projectFileWatchersFor()
        .setWatchedDirectories(context.clientId, parsed);
    },
  );
}
