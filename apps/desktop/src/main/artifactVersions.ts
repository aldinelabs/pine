import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import cacache from "cacache";
import { structuredPatch } from "diff";
import {
  backupEntryKey,
  integrityOf,
  newBackupId,
  ARTIFACT_STORE_DIRECTORY,
  type ArtifactEntryMetadata,
} from "../agent/artifactStore";
import {
  ARTIFACT_VERSION_QUOTA_BYTES,
  MAX_ARTIFACT_DIFF_BYTES,
  MAX_ARTIFACT_SNAPSHOT_BYTES,
  type ArtifactDiffLine,
  type ArtifactVersion,
  type ArtifactVersionDiff,
  type ArtifactVersionHistory,
  type ArtifactVersionRef,
  type SessionArtifact,
} from "../shared/artifacts";

export function artifactStoreRoot(dataPaths: { projectRoot: string }): string {
  return path.join(dataPaths.projectRoot, ARTIFACT_STORE_DIRECTORY);
}

// cacache's `rm.entry` takes options its type definitions omit. Removing the
// index bucket fully keeps the index from growing with tombstones.
const removeEntryWithOptions = cacache.rm.entry as (
  cache: string,
  key: string,
  options: { removeFully: boolean },
) => Promise<unknown>;

function removeEntry(store: string, key: string): Promise<unknown> {
  return removeEntryWithOptions(store, key, { removeFully: true });
}

interface StoreEntry {
  key: string;
  integrity: string;
  size: number;
  time: number;
  metadata: ArtifactEntryMetadata;
}

function isMetadata(value: unknown): value is ArtifactEntryMetadata {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.kind === "submission" || record.kind === "backup") &&
    typeof record.sessionId === "string" &&
    typeof record.path === "string" &&
    typeof record.time === "number"
  );
}

/** The store's live index entries; none for a store not created yet. */
async function storeEntries(store: string): Promise<StoreEntry[]> {
  let listing: Awaited<ReturnType<typeof cacache.ls>>;
  try {
    listing = await cacache.ls(store);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  return Object.values(listing).flatMap((entry) =>
    isMetadata(entry.metadata) && typeof entry.integrity === "string"
      ? [
          {
            key: entry.key,
            integrity: entry.integrity,
            size: entry.size ?? 0,
            time: entry.time,
            metadata: entry.metadata,
          },
        ]
      : [],
  );
}

async function hasContent(store: string, integrity: string): Promise<boolean> {
  return !!(await cacache.get.hasContent(store, integrity).catch(() => false));
}

/** The file's integrity when it is small enough to hash, else null; undefined when missing. */
async function currentIntegrity(
  filePath: string,
): Promise<{ integrity: string | null; size: number } | undefined> {
  const metadata = await stat(filePath).catch(() => null);
  if (!metadata?.isFile()) return undefined;
  if (metadata.size > MAX_ARTIFACT_SNAPSHOT_BYTES)
    return { integrity: null, size: metadata.size };
  const data = await readFile(filePath);
  return { integrity: integrityOf(data), size: data.byteLength };
}

interface StoredVersion {
  version: ArtifactVersion;
  integrity?: string;
}

export interface ArtifactHistoryInput {
  store: string;
  sessionId: string;
  path: string;
  /** The file's submissions in this session, any order. */
  submissions: readonly SessionArtifact[];
  restorable: boolean;
}

async function collectVersions(
  input: ArtifactHistoryInput,
  current: { integrity: string | null } | undefined,
): Promise<StoredVersion[]> {
  const found: StoredVersion[] = [];
  const isCurrent = (integrity: string) =>
    !!current?.integrity && current.integrity === integrity;
  for (const submission of input.submissions) {
    const snapshot = submission.snapshot;
    // A submission from before versions were kept has nothing to show.
    if (!snapshot) continue;
    const ref: ArtifactVersionRef = {
      kind: "submission",
      toolCallId: submission.toolCallId,
    };
    const title = {
      ...(submission.title ? { title: submission.title } : {}),
      ...(submission.description
        ? { description: submission.description }
        : {}),
    };
    if (snapshot.status === "stored") {
      const available = await hasContent(input.store, snapshot.integrity);
      found.push({
        integrity: snapshot.integrity,
        version: {
          ref,
          time: snapshot.time,
          size: snapshot.size,
          ...title,
          state: available ? "available" : "pruned",
          current: isCurrent(snapshot.integrity),
        },
      });
    } else {
      found.push({
        version: {
          ref,
          time: snapshot.time,
          ...(snapshot.status === "skipped" ? { size: snapshot.size } : {}),
          ...title,
          state: snapshot.status === "skipped" ? "too-large" : "failed",
          current: false,
        },
      });
    }
  }
  for (const entry of await storeEntries(input.store)) {
    const { metadata } = entry;
    if (
      metadata.kind !== "backup" ||
      metadata.sessionId !== input.sessionId ||
      metadata.path !== input.path ||
      !metadata.backupId
    )
      continue;
    found.push({
      integrity: entry.integrity,
      version: {
        ref: { kind: "backup", id: metadata.backupId },
        time: metadata.time,
        size: entry.size,
        state: (await hasContent(input.store, entry.integrity))
          ? "available"
          : "pruned",
        current: isCurrent(entry.integrity),
      },
    });
  }
  return found.sort((a, b) => b.version.time - a.version.time);
}

export async function readVersionHistory(
  input: ArtifactHistoryInput,
): Promise<ArtifactVersionHistory> {
  const current = await currentIntegrity(input.path);
  const versions = await collectVersions(input, current);
  const newestStored = versions.find(({ integrity }) => integrity);
  return {
    path: input.path,
    versions: versions.map(({ version }) => version),
    missing: !current,
    modified: !!current && !!newestStored && !newestStored.version.current,
    restorable: input.restorable,
  };
}

/** The stored content of one available version, or null. */
async function versionIntegrity(
  input: ArtifactHistoryInput,
  ref: ArtifactVersionRef,
): Promise<string | null> {
  const versions = await collectVersions(input, undefined);
  const match = versions.find(({ version }) =>
    ref.kind === "submission"
      ? version.ref.kind === "submission" &&
        version.ref.toolCallId === ref.toolCallId
      : version.ref.kind === "backup" && version.ref.id === ref.id,
  );
  return match?.integrity && match.version.state === "available"
    ? match.integrity
    : null;
}

function digestFolder(integrity: string): string {
  return Buffer.from(integrity.replace(/^sha512-/, ""), "base64").toString(
    "hex",
  );
}

/**
 * Writes a version to `<temporary>/artifact-versions/<digest>/<file name>`
 * for the preview, which opens it like a presented file. Returns its path.
 */
export async function materializeVersion(
  input: ArtifactHistoryInput,
  ref: ArtifactVersionRef,
  temporaryRoot: string,
): Promise<string> {
  const integrity = await versionIntegrity(input, ref);
  if (!integrity) throw new Error("This version is no longer stored.");
  const directory = path.join(
    temporaryRoot,
    ARTIFACT_STORE_DIRECTORY,
    digestFolder(integrity),
  );
  const target = path.join(directory, path.basename(input.path));
  if (await stat(target).catch(() => null)) return target;
  const data = await cacache.get.byDigest(input.store, integrity);
  await mkdir(directory, { recursive: true });
  const partial = `${target}.${randomUUID()}.partial`;
  await writeFile(partial, data);
  await rename(partial, target);
  return target;
}

function looksBinary(data: Uint8Array): boolean {
  return data.subarray(0, 8192).includes(0);
}

/** A line diff from the version to the file as it is now. */
export async function diffVersion(
  input: ArtifactHistoryInput,
  ref: ArtifactVersionRef,
): Promise<ArtifactVersionDiff> {
  const integrity = await versionIntegrity(input, ref);
  if (!integrity) throw new Error("This version is no longer stored.");
  const metadata = await stat(input.path).catch(() => null);
  if (!metadata?.isFile()) return { status: "unsupported", reason: "missing" };
  if (metadata.size > MAX_ARTIFACT_DIFF_BYTES)
    return { status: "unsupported", reason: "too-large" };
  const before = await cacache.get.byDigest(input.store, integrity);
  if (before.byteLength > MAX_ARTIFACT_DIFF_BYTES)
    return { status: "unsupported", reason: "too-large" };
  const after = await readFile(input.path);
  if (looksBinary(before) || looksBinary(after))
    return { status: "unsupported", reason: "binary" };
  const oldText = before.toString("utf8");
  const newText = after.toString("utf8");
  if (oldText === newText) return { status: "identical" };
  const patch = structuredPatch("", "", oldText, newText, "", "", {
    context: 3,
  });
  return {
    status: "ok",
    hunks: patch.hunks.map((hunk) => ({
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines.flatMap((line): ArtifactDiffLine[] => {
        const text = line.slice(1);
        if (line.startsWith("+")) return [{ type: "add", text }];
        if (line.startsWith("-")) return [{ type: "remove", text }];
        if (line.startsWith(" ")) return [{ type: "context", text }];
        // "\ No newline at end of file"
        return [];
      }),
    })),
  };
}

/**
 * Puts a version back at the file's path. The file as it is now is kept as a
 * backup first, unless it already matches a stored version, so a restore can
 * itself be undone. The write goes through a temporary file in the same
 * folder and a rename, so the file is never left half written.
 */
export async function restoreVersion(
  input: ArtifactHistoryInput,
  ref: ArtifactVersionRef,
): Promise<void> {
  const integrity = await versionIntegrity(input, ref);
  if (!integrity) throw new Error("This version is no longer stored.");
  const data = await cacache.get.byDigest(input.store, integrity);
  const metadata = await stat(input.path).catch(() => null);
  if (metadata && !metadata.isFile())
    throw new Error("The artifact's path is no longer a file.");
  if (metadata) {
    if (metadata.size > MAX_ARTIFACT_SNAPSHOT_BYTES)
      throw new Error(
        "The current file is too large to keep a copy of, so it is not replaced.",
      );
    const current = await readFile(input.path);
    const currentHash = integrityOf(current);
    if (currentHash === integrity) return;
    const known = (await collectVersions(input, undefined)).some(
      (version) =>
        version.integrity === currentHash &&
        version.version.state === "available",
    );
    if (!known) {
      const backupId = newBackupId();
      await cacache.put(
        input.store,
        backupEntryKey(input.sessionId, backupId),
        current,
        {
          metadata: {
            kind: "backup",
            sessionId: input.sessionId,
            path: input.path,
            time: Date.now(),
            backupId,
          } satisfies ArtifactEntryMetadata,
        },
      );
    }
  }
  const partial = path.join(
    path.dirname(input.path),
    `.${path.basename(input.path)}.${randomUUID()}.pine-restore`,
  );
  try {
    await writeFile(partial, data, metadata ? { mode: metadata.mode } : {});
    await rename(partial, input.path);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Drops the oldest versions until the store's content fits the quota. Every
 * file's newest version in each session goes last. Then cacache collects the
 * content no entry refers to any more.
 */
export async function pruneStore(
  store: string,
  quota = ARTIFACT_VERSION_QUOTA_BYTES,
): Promise<void> {
  const entries = await storeEntries(store);
  if (!entries.length) return;
  const references = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const entry of entries) {
    references.set(entry.integrity, (references.get(entry.integrity) ?? 0) + 1);
    sizes.set(entry.integrity, entry.size);
  }
  let total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (total > quota) {
    const newest = new Map<string, StoreEntry>();
    for (const entry of entries) {
      const file = `${entry.metadata.sessionId}\n${entry.metadata.path}`;
      const previous = newest.get(file);
      if (!previous || previous.metadata.time < entry.metadata.time)
        newest.set(file, entry);
    }
    const protectedKeys = new Set([...newest.values()].map(({ key }) => key));
    const byAge = [...entries].sort(
      (a, b) => a.metadata.time - b.metadata.time,
    );
    const order = [
      ...byAge.filter(({ key }) => !protectedKeys.has(key)),
      ...byAge.filter(({ key }) => protectedKeys.has(key)),
    ];
    for (const entry of order) {
      if (total <= quota) break;
      await removeEntry(store, entry.key);
      const remaining = (references.get(entry.integrity) ?? 1) - 1;
      references.set(entry.integrity, remaining);
      if (remaining === 0) total -= entry.size;
    }
  }
  await cacache.verify(store);
}

/** Forgets a deleted session's versions and collects their content. */
export async function removeSessionVersions(
  store: string,
  sessionId: string,
): Promise<void> {
  const entries = await storeEntries(store);
  const owned = entries.filter(
    ({ metadata }) => metadata.sessionId === sessionId,
  );
  if (!owned.length) return;
  for (const entry of owned) await removeEntry(store, entry.key);
  await cacache.verify(store);
}

/** At most one full check of a store per this long. */
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Prunes the store if it was not checked within the last day. */
export async function maintainStore(
  store: string,
  quota = ARTIFACT_VERSION_QUOTA_BYTES,
): Promise<void> {
  const lastRun = await cacache.verify.lastRun(store).catch(() => null);
  if (lastRun && Date.now() - lastRun.getTime() < MAINTENANCE_INTERVAL_MS)
    return;
  if (!(await stat(store).catch(() => null))) return;
  await pruneStore(store, quota);
}
