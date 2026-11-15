import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import cacache from "cacache";
import {
  MAX_ARTIFACT_SNAPSHOT_BYTES,
  type ArtifactSnapshot,
} from "../shared/artifacts";

/**
 * Stored copies of submitted artifacts, one content-addressed cacache store
 * per project (`<project data>/artifact-versions`). cacache writes atomically,
 * verifies content on read and keeps concurrent writers apart, so several
 * sessions may submit at once. The index only holds references: the session
 * transcript records which version is which, and an index entry keeps its
 * content from being collected.
 */
export const ARTIFACT_STORE_DIRECTORY = "artifact-versions";

export interface ArtifactEntryMetadata {
  kind: "submission" | "backup";
  sessionId: string;
  path: string;
  time: number;
  /** The submission's tool call. */
  toolCallId?: string;
  /** A backup's id. */
  backupId?: string;
}

export function submissionEntryKey(
  sessionId: string,
  toolCallId: string,
  filePath: string,
): string {
  return ["submission", sessionId, toolCallId, filePath].join("\n");
}

export function backupEntryKey(sessionId: string, backupId: string): string {
  return ["backup", sessionId, backupId].join("\n");
}

/** The cacache integrity (`sha512-<base64>`) of some bytes. */
export function integrityOf(data: Uint8Array): string {
  return `sha512-${createHash("sha512").update(data).digest("base64")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copies a file into the store under `key`. It never throws: a file too
 * large to keep, or one that could not be read or written, is reported in the
 * result so the submission itself still succeeds.
 */
export async function snapshotFile(
  store: string,
  key: string,
  filePath: string,
  metadata: ArtifactEntryMetadata,
  limit = MAX_ARTIFACT_SNAPSHOT_BYTES,
): Promise<ArtifactSnapshot> {
  const time = metadata.time;
  try {
    const before = await stat(filePath);
    if (before.size > limit)
      return {
        status: "skipped",
        reason: "too-large",
        size: before.size,
        time,
      };
    const data = await readFile(filePath);
    // The file grew between the size check and the read.
    if (data.byteLength > limit)
      return {
        status: "skipped",
        reason: "too-large",
        size: data.byteLength,
        time,
      };
    // cacache returns an ssri Integrity object; the record keeps its string.
    const integrity = String(await cacache.put(store, key, data, { metadata }));
    // The modification time from before the read: a change during the read
    // then shows as "modified" rather than hiding behind a newer time.
    return {
      status: "stored",
      integrity,
      size: data.byteLength,
      mtimeMs: before.mtimeMs,
      time,
    };
  } catch (error) {
    return { status: "failed", reason: message(error), time };
  }
}

/** A new id for a backup entry. */
export function newBackupId(): string {
  return randomUUID();
}
