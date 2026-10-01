export const LIST_PROJECT_DIRECTORY_CHANNEL =
  "project-files:list-directory" as const;

export type ProjectEntryKind = "directory" | "file";

export interface ProjectEntry {
  kind: ProjectEntryKind;
  name: string;
  relativePath: string;
}

export interface ListProjectDirectoryRequest {
  folderId: string;
  relativePath: string;
}

export interface ListProjectDirectoryResult {
  entries: ProjectEntry[];
}

export const PROJECT_FILE_OPERATION_CHANNEL = "project-files:operate" as const;
export const START_PROJECT_FILE_DRAG_CHANNEL =
  "project-files:start-drag" as const;

export const SET_WATCHED_PROJECT_DIRECTORIES_CHANNEL =
  "project-files:set-watched-directories" as const;
export const PROJECT_FILES_CHANGED_CHANNEL = "project-files:changed" as const;

export const MAX_WATCHED_PROJECT_FOLDERS = 64;
export const MAX_WATCHED_PROJECT_DIRECTORIES = 2_048;

export interface WatchedProjectFolder {
  folderId: string;
  /** Portable relative paths of the directories to watch. "" is the root. */
  directories: string[];
}

export interface SetWatchedProjectDirectoriesRequest {
  /** Full desired watch state for the sender; replaces all previous folders. */
  folders: WatchedProjectFolder[];
}

export interface ProjectFolderFileChanges {
  folderId: string;
  /** Portable relative paths of watched directories whose contents changed. */
  changedDirs: string[];
}
export interface ProjectFilesChangedEvent {
  folders: ProjectFolderFileChanges[];
}
export const PROJECT_FILE_ATTACHMENTS_CHANNEL =
  "project-files:attachments" as const;
export type ProjectEntryReference = ListProjectDirectoryRequest;
export type StartProjectFileDragRequest = ProjectEntryReference;

export const READ_PROJECT_FILE_PREVIEW_CHANNEL =
  "project-files:preview" as const;
export const READ_PRESENTED_FILE_PREVIEW_CHANNEL =
  "project-files:preview-presented" as const;
export const REOPEN_PRESENTED_TOOL_FILE_CHANNEL =
  "project-files:reopen-presented-tool-file" as const;
export const PROJECT_MEDIA_PROTOCOL = "pine-project-media" as const;
export const MARKDOWN_IMAGE_PARAM = "markdownImage" as const;
export interface ReopenPresentedToolFileRequest {
  sessionId: string;
  toolCallId: string;
}
export interface ProjectFilePreviewRequest extends ProjectEntryReference {
  projectId: string;
}
/**
 * A file the agent asked the user to look at, addressed by absolute path
 * because it lives outside every project folder. The main process only serves
 * paths it already authorized for this window, so an external file tab never
 * widens what this window may read.
 */
export interface PresentedFilePreviewRequest {
  path: string;
}
/**
 * Where a file tab reads its content from. Project files keep the portable
 * folder-relative reference; presented files carry the absolute path the main
 * process approved when the agent presented them.
 */
export type FilePreviewTarget =
  | ({ source: "project" } & ProjectFilePreviewRequest)
  | ({ source: "presented" } & PresentedFilePreviewRequest);
export const SET_WATCHED_FILE_PREVIEW_CHANNEL =
  "project-files:set-watched-preview" as const;
export const FILE_PREVIEW_CHANGED_CHANNEL =
  "project-files:preview-changed" as const;
export interface SetWatchedFilePreviewRequest {
  /** Component-owned subscription; null removes it without affecting other tabs. */
  watchId: string;
  target: FilePreviewTarget | null;
}
export interface FilePreviewChangedEvent {
  watchId: string;
}
export interface ProjectFileMetadata {
  size: number;
  modifiedAt: string;
}
export type OfficeDocumentFormat = "docx" | "xls" | "xlsx" | "pptx";
export type ProjectFilePreview = ProjectFileMetadata &
  (
    | {
        kind: "text";
        text: string;
        encoding: string;
        /** Owner-scoped document URL used to resolve relative Markdown images. */
        url?: string;
      }
    | { kind: "image" | "video" | "pdf"; url: string }
    | { kind: "office"; format: OfficeDocumentFormat; url: string }
    | { kind: "unsupported"; reason: "binary" | "too-large" }
  );

export type ProjectFileOperation =
  | {
      action: "create";
      target: ProjectEntryReference;
      name: string;
      kind: ProjectEntryKind;
    }
  | { action: "rename"; target: ProjectEntryReference; name: string }
  | {
      action: "trash" | "open" | "reveal" | "copy-path";
      target: ProjectEntryReference;
    }
  | {
      action: "move";
      target: ProjectEntryReference;
      sources: ProjectEntryReference[];
    }
  | { action: "move-external"; target: ProjectEntryReference; paths: string[] };
