import {
  UI_PRESENT_FILE_TOOL_NAME,
  UI_SUBMIT_ARTIFACT_TOOL_NAME,
} from "./agent";
import type { PineToolCall } from "./sessions";

/**
 * A session artifact: a deliverable the agent submitted with
 * `ui_submit_artifact`, or (for sessions from before that tool existed) a
 * file it presented with `ui_present_file`.
 */
export interface SessionArtifact {
  toolCallId: string;
  /** The absolute path the tool result recorded. */
  path: string;
  title?: string;
  description?: string;
  /**
   * The Artifacts folder the agent filed it under ("Reports/Week 1"); ""
   * files it at the top level explicitly, absent means none was given.
   */
  folder?: string;
  /** True for a submitted file, false for a legacy presentation. */
  submitted: boolean;
  /** The copy a submission kept; absent for presentations and older submissions. */
  snapshot?: ArtifactSnapshot;
}

/** Most files one `ui_submit_artifact` call accepts. */
export const MAX_SUBMITTED_ARTIFACTS = 50;

/** Deepest folder an artifact can be filed under. */
export const MAX_ARTIFACT_FOLDER_DEPTH = 4;
/** Longest folder name (one level) kept. */
export const MAX_ARTIFACT_FOLDER_NAME_LENGTH = 80;

/**
 * A folder path as `ui_submit_artifact` records it: levels split on `/` or
 * `\`, trimmed, without empty, `.` and `..` levels, at most
 * `MAX_ARTIFACT_FOLDER_DEPTH` deep. "" is the top level.
 */
export function normalizeArtifactFolder(value: string): string {
  return value
    .split(/[/\\]/)
    .map((name) => name.trim().slice(0, MAX_ARTIFACT_FOLDER_NAME_LENGTH).trim())
    .filter((name) => name && name !== "." && name !== "..")
    .slice(0, MAX_ARTIFACT_FOLDER_DEPTH)
    .join("/");
}

/**
 * Key for target and removal maps: the tool call id for a presentation, the
 * tool call id and path for a submitted file (one call submits many files).
 */
export function artifactKey(toolCallId: string, path?: string): string {
  return path ? `${toolCallId}\n${path}` : toolCallId;
}

function detailsOf(call: PineToolCall): Record<string, unknown> | undefined {
  if (typeof call.output !== "object" || call.output === null) return undefined;
  const details = (call.output as { details?: unknown }).details;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Accepted files of a complete `ui_submit_artifact` call, in the order given; [] otherwise. */
export function submittedArtifactsOfCall(
  call: PineToolCall,
): SessionArtifact[] {
  if (call.name !== UI_SUBMIT_ARTIFACT_TOOL_NAME || call.status !== "complete")
    return [];
  const files = detailsOf(call)?.files;
  if (!Array.isArray(files)) return [];
  const artifacts: SessionArtifact[] = [];
  for (const file of files) {
    if (typeof file !== "object" || file === null) continue;
    const record = file as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path) continue;
    const title = optionalText(record.title);
    const description = optionalText(record.description);
    const snapshot = parseArtifactSnapshot(record.snapshot);
    const folder =
      typeof record.folder === "string"
        ? normalizeArtifactFolder(record.folder)
        : undefined;
    artifacts.push({
      toolCallId: call.id,
      path: record.path,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(folder !== undefined ? { folder } : {}),
      submitted: true,
      ...(snapshot ? { snapshot } : {}),
    });
  }
  return artifacts;
}

/**
 * A presentation from before `ui_submit_artifact` existed: a complete
 * `ui_present_file` call whose details lack `artifact: false`.
 */
export function legacyPresentedArtifactOfCall(
  call: PineToolCall,
): SessionArtifact | null {
  if (call.name !== UI_PRESENT_FILE_TOOL_NAME || call.status !== "complete")
    return null;
  const details = detailsOf(call);
  if (details?.artifact === false) return null;
  const input =
    typeof call.input === "object" && call.input !== null
      ? (call.input as { path?: unknown })
      : undefined;
  const path =
    typeof details?.path === "string" && details.path
      ? details.path
      : typeof input?.path === "string" && input.path.trim()
        ? input.path.trim()
        : null;
  return path ? { toolCallId: call.id, path, submitted: false } : null;
}

/** The artifacts of one message's (or any list's) tool calls. */
export interface CallArtifacts {
  /**
   * Submitted files in collection order: calls in transcript order, each
   * call's files reversed, so `collectArtifacts` keeps a batch's own order.
   */
  submitted: readonly SessionArtifact[];
  legacy: readonly SessionArtifact[];
  /**
   * A completed submission that accepted a file. A running or failed one does
   * not count, so the list switches from legacy to submitted in one step.
   */
  hasSubmission: boolean;
}

export function artifactsOfCalls(calls: Iterable<PineToolCall>): CallArtifacts {
  const submitted: SessionArtifact[] = [];
  const legacy: SessionArtifact[] = [];
  let hasSubmission = false;
  for (const call of calls) {
    if (call.name === UI_SUBMIT_ARTIFACT_TOOL_NAME) {
      const files = submittedArtifactsOfCall(call);
      if (files.length > 0) hasSubmission = true;
      for (let index = files.length - 1; index >= 0; index -= 1)
        submitted.push(files[index]);
      continue;
    }
    const presented = legacyPresentedArtifactOfCall(call);
    if (presented) legacy.push(presented);
  }
  return { submitted, legacy, hasSubmission };
}

/**
 * The session's artifacts, newest first and one per path. A resubmission
 * without a folder stays in the folder it was filed under. Once any submission
 * exists only submitted files count; otherwise presentations recorded before
 * `ui_submit_artifact` existed do, so older sessions keep their list.
 *
 * The renderer passes only the loaded transcript pages: a session continued
 * across the upgrade whose submissions are all in unloaded pages lists its
 * pre-upgrade presentations until those pages load.
 */
export function collectArtifacts(
  chunks: Iterable<CallArtifacts>,
): SessionArtifact[] {
  const list = [...chunks];
  const useSubmitted = list.some((chunk) => chunk.hasSubmission);
  const byPath = new Map<string, SessionArtifact>();
  for (const chunk of list) {
    for (const artifact of useSubmitted ? chunk.submitted : chunk.legacy) {
      const previous = byPath.get(artifact.path);
      byPath.delete(artifact.path);
      byPath.set(
        artifact.path,
        artifact.folder === undefined && previous?.folder !== undefined
          ? { ...artifact, folder: previous.folder }
          : artifact,
      );
    }
  }
  return [...byPath.values()].reverse();
}

/** A folder of the Artifacts tree and what it holds. */
export interface ArtifactFolderNode<T> {
  /** The folder's path from the top level ("Reports/Week 1"). */
  path: string;
  name: string;
  folders: ArtifactFolderNode<T>[];
  /** Files directly in this folder, in the order given. */
  files: T[];
}

/**
 * Files the Artifacts list in folders. Folders come before files at each
 * level, ordered by their newest file; files keep the order given (newest
 * first). A file without a folder sits at the top level.
 */
export function artifactTree<T extends { folder?: string }>(
  artifacts: readonly T[],
): ArtifactFolderNode<T> {
  const root: ArtifactFolderNode<T> = {
    path: "",
    name: "",
    folders: [],
    files: [],
  };
  const byPath = new Map<string, ArtifactFolderNode<T>>([["", root]]);
  function folderAt(path: string): ArtifactFolderNode<T> {
    const known = byPath.get(path);
    if (known) return known;
    const slash = path.lastIndexOf("/");
    const parent = folderAt(slash < 0 ? "" : path.slice(0, slash));
    const node: ArtifactFolderNode<T> = {
      path,
      name: path.slice(slash + 1),
      folders: [],
      files: [],
    };
    parent.folders.push(node);
    byPath.set(path, node);
    return node;
  }
  for (const artifact of artifacts)
    folderAt(artifact.folder ?? "").files.push(artifact);
  return root;
}

/** Largest file a submission keeps a copy of; a larger one only records its size. */
export const MAX_ARTIFACT_SNAPSHOT_BYTES = 25 * 1024 * 1024;
/** Stored versions a project keeps before the oldest are dropped. */
export const ARTIFACT_VERSION_QUOTA_BYTES = 1024 * 1024 * 1024;
/** Largest text file "Compare with current" reads. */
export const MAX_ARTIFACT_DIFF_BYTES = 1024 * 1024;

/**
 * What a submission kept of one file, recorded in the tool result. `time` is
 * when the copy was taken, in milliseconds since the epoch.
 */
export type ArtifactSnapshot =
  | {
      status: "stored";
      integrity: string;
      size: number;
      mtimeMs: number;
      time: number;
    }
  | { status: "skipped"; reason: "too-large"; size: number; time: number }
  | { status: "failed"; reason: string; time: number };

/** Reads a snapshot record from untrusted tool output; undefined when absent or malformed. */
export function parseArtifactSnapshot(
  value: unknown,
): ArtifactSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const time = typeof record.time === "number" ? record.time : undefined;
  if (time === undefined) return undefined;
  if (
    record.status === "stored" &&
    typeof record.integrity === "string" &&
    record.integrity &&
    typeof record.size === "number" &&
    typeof record.mtimeMs === "number"
  )
    return {
      status: "stored",
      integrity: record.integrity,
      size: record.size,
      mtimeMs: record.mtimeMs,
      time,
    };
  if (
    record.status === "skipped" &&
    record.reason === "too-large" &&
    typeof record.size === "number"
  )
    return { status: "skipped", reason: "too-large", size: record.size, time };
  if (record.status === "failed")
    return {
      status: "failed",
      reason: typeof record.reason === "string" ? record.reason : "",
      time,
    };
  return undefined;
}

/**
 * One version of an artifact. A submission is identified by its tool call; a
 * copy Pine took of the file before restoring an older version, by its id.
 */
export type ArtifactVersionRef =
  { kind: "submission"; toolCallId: string } | { kind: "backup"; id: string };

export interface ArtifactVersion {
  ref: ArtifactVersionRef;
  /** When the copy was taken (or the submission recorded, for one without a copy). */
  time: number;
  size?: number;
  title?: string;
  /** What the agent said about this submission. */
  description?: string;
  /**
   * `available` can be previewed and restored; `pruned` was stored and later
   * dropped to stay within the storage limit; `too-large` and `failed` were
   * never stored.
   */
  state: "available" | "pruned" | "too-large" | "failed";
  /** The file on disk still has this content (by size and modification time). */
  current: boolean;
}

export interface ArtifactVersionHistory {
  path: string;
  /** Newest first. */
  versions: ArtifactVersion[];
  /** The file exists but differs from its newest stored version. */
  modified: boolean;
  /** The file no longer exists at its path. */
  missing: boolean;
  /** Restoring is possible: the file is in a read-write project folder. */
  restorable: boolean;
}

export type ArtifactDiffLine = {
  type: "add" | "remove" | "context";
  text: string;
};

export interface ArtifactDiffHunk {
  oldStart: number;
  newStart: number;
  lines: ArtifactDiffLine[];
}

export type ArtifactVersionDiff =
  | {
      status: "ok";
      hunks: ArtifactDiffHunk[];
      /** Both texts in full, for a rendered comparison (Markdown). */
      before: string;
      after: string;
    }
  | { status: "identical" }
  | { status: "unsupported"; reason: "binary" | "too-large" | "missing" };
