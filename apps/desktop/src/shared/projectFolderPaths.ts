/**
 * Path checks for a project's folders that run in any process. A project's
 * folders must not repeat or nest inside one another (the main process
 * rejects such a project), so the editor uses these to keep its list valid.
 * Paths are absolute, as the folder picker and the main process report them.
 */

const WINDOWS_PATH = /^[a-zA-Z]:[\\/]|^\\\\/;

function normalizeFolderPath(folderPath: string): string {
  const isWindows = WINDOWS_PATH.test(folderPath);
  let normalized = isWindows ? folderPath.replaceAll("\\", "/") : folderPath;
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  // Windows drive roots keep their separator: "C:/" rather than "C:".
  if (/^[a-zA-Z]:$/.test(normalized)) normalized += "/";
  return isWindows ? normalized.toLowerCase() : normalized;
}

/** Whether `candidatePath` is `parentPath` itself or lies inside it. */
export function projectFolderContains(
  parentPath: string,
  candidatePath: string,
): boolean {
  const parent = normalizeFolderPath(parentPath);
  const candidate = normalizeFolderPath(candidatePath);
  if (candidate === parent) return true;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return candidate.startsWith(prefix);
}

/** Whether two folders are the same or one is inside the other. */
export function projectFoldersOverlap(left: string, right: string): boolean {
  return (
    projectFolderContains(left, right) || projectFolderContains(right, left)
  );
}
