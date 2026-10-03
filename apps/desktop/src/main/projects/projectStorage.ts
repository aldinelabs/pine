import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type {
  ClearableProjectStorage,
  ProjectStorageUsage,
} from "../../shared/projects";
import type { ProjectDataPaths } from "./projectRepository";

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** Apparent size of a directory tree; symlinks count as links, not targets. */
export async function directorySize(directory: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return directorySize(entryPath);
      try {
        return (await lstat(entryPath)).size;
      } catch (error) {
        if (isMissing(error)) return 0;
        throw error;
      }
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function temporaryRoot(dataPaths: ProjectDataPaths): string {
  return dataPaths.temporaryRoot ?? path.join(dataPaths.projectRoot, "tmp");
}

export async function measureProjectStorage(
  projectId: string,
  dataPaths: ProjectDataPaths,
): Promise<ProjectStorageUsage> {
  const [attachments, cache, sessions, temporary] = await Promise.all([
    directorySize(dataPaths.attachmentsRoot),
    directorySize(dataPaths.cacheRoot),
    directorySize(dataPaths.sessionsRoot),
    directorySize(temporaryRoot(dataPaths)),
  ]);
  return {
    projectId,
    attachments,
    cache,
    sessions,
    temporary,
    total: attachments + cache + sessions + temporary,
  };
}

async function removeChildren(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => !entry.isDirectory())
      .map((entry) => rm(path.join(directory, entry.name), { force: true })),
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));
}

/**
 * Remove one clearable kind of Pine data. Each working directory keeps its
 * own temporary folder, which an idle session's shell still points at, so
 * those folders are emptied rather than deleted.
 */
export async function clearProjectStorage(
  dataPaths: ProjectDataPaths,
  kind: ClearableProjectStorage,
): Promise<void> {
  if (kind === "attachments") {
    await rm(dataPaths.attachmentsRoot, { recursive: true, force: true });
    return;
  }
  const workingDirectories = await removeChildren(temporaryRoot(dataPaths));
  await Promise.all(
    workingDirectories.map(async (directory) => {
      for (const child of await removeChildren(directory)) {
        await rm(child, { recursive: true, force: true });
      }
    }),
  );
}
