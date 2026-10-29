export const LIST_PROJECT_DIRECTORY_CHANNEL =
  "project-files:list-directory" as const;

export type ProjectEntryKind = "directory" | "file";

/** A compact workbench card or the full previewer in a main content tab. */
export type FilePresentationDisplay = "sidebar" | "fullscreen";

export interface ProjectEntry {
  kind: ProjectEntryKind;
  name: string;
  relativePath: string;
}

export interface ListProjectDirectoryRequest {
  folderId: string;
  projectId: string;
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
  projectId: string;
  /** Portable relative paths of the directories to watch. "" is the root. */
  directories: string[];
}

export interface SetWatchedProjectDirectoriesRequest {
  /** Full desired watch state for the sender; replaces all previous folders. */
  folders: WatchedProjectFolder[];
}

export interface ProjectFolderFileChanges {
  folderId: string;
  projectId: string;
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
  projectId: string;
  sessionId: string;
  toolCallId: string;
}
export type ProjectFilePreviewRequest = ProjectEntryReference;
/**
 * A file the agent asked the user to look at, addressed by absolute path
 * because it lives outside every project folder. The main process only serves
 * paths it already authorized for this window, so an external file tab never
 * widens what this window may read.
 */
export interface PresentedFilePreviewRequest {
  path: string;
}
export const PRESENTED_FILE_OPERATION_CHANNEL =
  "project-files:operate-presented" as const;
/**
 * The read-only native actions a presented file supports. Anything that
 * changes the file (rename, trash) stays limited to project folders.
 */
export interface PresentedFileOperation extends PresentedFilePreviewRequest {
  action: "open" | "reveal" | "copy-path";
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
export type ProjectFilePreview = ProjectFileMetadata &
  (
    | {
        kind: "text";
        text: string;
        encoding: string;
        /** Owner-scoped document URL used to resolve relative Markdown images. */
        url?: string;
      }
    /** Rendered by file-viewer from the bytes behind the owner-scoped URL. */
    | { kind: "document"; url: string }
    /** Played by a native video element that streams byte ranges. */
    | { kind: "video"; url: string }
    /** Played by a native audio element that streams byte ranges. */
    | { kind: "audio"; url: string }
    | {
        kind: "unsupported";
        reason: "binary" | "too-large" | "document-too-large";
      }
  );

/** Larger files preview as unsupported rather than as text. */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/** Documents are read whole into the renderer, so larger ones are not previewed. */
export const MAX_DOCUMENT_PREVIEW_BYTES = 1024 * 1024 * 1024;

/**
 * Decodes file bytes the way the previewer does: UTF-16 with a byte order
 * mark, otherwise strict UTF-8. Returns null for content that is not text.
 */
export function decodePreviewText(
  contents: Uint8Array,
): { text: string; encoding: string } | null {
  const encoding =
    contents[0] === 0xff && contents[1] === 0xfe
      ? "utf-16le"
      : contents[0] === 0xfe && contents[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(contents);
    if (/[\u0000-\u0008\u000e-\u001f]/u.test(text)) return null;
    return { text, encoding: encoding.toUpperCase() };
  } catch {
    return null;
  }
}

/** Splits text the way the previewer numbers its lines. */
export function countPreviewLines(text: string): number {
  return text.split(/\r\n|\r|\n/).length;
}

/** Inclusive, 1-based line range of a text file. */
export interface FileLineRange {
  start: number;
  end: number;
}

/**
 * Where a text preview opens: the line scrolled into view and the line ranges
 * tinted for the reader. Lines refer to the file's source, so a file shown
 * with a location renders as source even when it could render as a document.
 */
export interface FileReveal {
  line: number;
  highlights: FileLineRange[];
}

export const MAX_FILE_REVEAL_HIGHLIGHTS = 20;

function isLineNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Reads a stored or forwarded reveal, dropping anything malformed. */
export function parseFileReveal(value: unknown): FileReveal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const stored = value as Record<string, unknown>;
  if (!isLineNumber(stored.line)) return undefined;
  const highlights = Array.isArray(stored.highlights)
    ? stored.highlights
        .filter(
          (range): range is FileLineRange =>
            typeof range === "object" &&
            range !== null &&
            isLineNumber((range as FileLineRange).start) &&
            isLineNumber((range as FileLineRange).end) &&
            (range as FileLineRange).end >= (range as FileLineRange).start,
        )
        .slice(0, MAX_FILE_REVEAL_HIGHLIGHTS)
        .map(({ start, end }) => ({ start, end }))
    : [];
  return { line: stored.line, highlights };
}

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
