import {
  cp,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { isValidHostProjectEntryName } from "./fileNames";
import type {
  ProjectEntryReference,
  ProjectFileOperation,
} from "../shared/projectFiles";
import type { PineProjectFolder } from "../shared/projects";
import { resolveProjectPath } from "./projectFiles";

export const ProjectEntryReferenceSchema = z.object({
  folderId: z.uuid(),
  projectId: z.uuid(),
  relativePath: z.string().max(4096),
});
const nameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) => isValidHostProjectEntryName(name),
    "Enter a valid file name for this platform.",
  );
const target = ProjectEntryReferenceSchema;
export const ProjectFileOperationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    target,
    name: nameSchema,
    kind: z.enum(["file", "directory"]),
  }),
  z.object({ action: z.literal("rename"), target, name: nameSchema }),
  z.object({
    action: z.enum(["trash", "open", "reveal", "copy-path"]),
    target,
  }),
  z.object({
    action: z.literal("move"),
    target,
    sources: z.array(target).min(1).max(100),
  }),
  z.object({
    action: z.literal("move-external"),
    target,
    paths: z
      .array(
        z
          .string()
          .min(1)
          .max(4096)
          .refine((filePath) => path.isAbsolute(filePath)),
      )
      .min(1)
      .max(100),
  }),
]);

export interface ProjectFileNativeActions {
  trash: (filePath: string) => Promise<void>;
  open: (filePath: string) => Promise<string>;
  reveal: (filePath: string) => void | Promise<void>;
  copyPath: (filePath: string) => void | Promise<void>;
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function resolveProjectEntry(
  folders: PineProjectFolder[],
  entry: ProjectEntryReference,
): Promise<string> {
  const folder = folders.find((candidate) => candidate.id === entry.folderId);
  if (!folder) throw new Error("Project folder not found.");
  return resolveProjectPath(folder, entry.relativePath);
}

/**
 * Resolve a visible project entry synchronously so Electron can start a native
 * drag while the browser's dragstart event is still active.
 */
export function resolveProjectEntryForNativeDrag(
  folders: PineProjectFolder[],
  entry: ProjectEntryReference,
): string {
  const folder = folders.find((candidate) => candidate.id === entry.folderId);
  if (!folder) throw new Error("Project folder not found.");
  if (path.isAbsolute(entry.relativePath) || entry.relativePath.includes("\0"))
    throw new Error("Expected a relative project path.");

  const resolvedRoot = realpathSync(folder.path);
  const requestedPath = path.resolve(resolvedRoot, entry.relativePath);
  if (!contains(resolvedRoot, requestedPath)) {
    throw new Error("Directory is outside the selected project folder.");
  }

  const resolvedPath = realpathSync(requestedPath);
  if (!contains(resolvedRoot, resolvedPath)) {
    throw new Error("Directory resolves outside the selected project folder.");
  }
  const metadata = lstatSync(resolvedPath);
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new Error("Only files and folders can be dragged.");
  }
  return resolvedPath;
}

async function assertMissing(destination: string): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `An entry named “${path.basename(destination)}” already exists.`,
  );
}

async function assertWritable(
  folders: PineProjectFolder[],
  candidate: string,
  destructive = false,
): Promise<void> {
  for (const folder of folders) {
    // Unavailable roots still retain their access policy at their configured path.
    const root = await realpath(folder.path).catch(() =>
      path.resolve(folder.path),
    );
    if (destructive && contains(candidate, root)) {
      throw new Error("Cannot move or delete a project root or its parent.");
    }
    if (
      folder.access === "read-only" &&
      (contains(root, candidate) || (destructive && contains(candidate, root)))
    ) {
      throw new Error("This project folder is read-only.");
    }
  }
}

async function moveEntry(source: string, destination: string): Promise<void> {
  if (isCaseOnlyRename(source, destination)) {
    const temporary = path.join(
      path.dirname(source),
      `.pine-case-rename-${randomUUID()}`,
    );
    await rename(source, temporary);
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rename(temporary, source).catch(() => undefined);
      throw error;
    }
    return;
  }
  await assertMissing(destination);
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    // Across volumes, only remove the source after the complete copy succeeds.
    // A failed copy keeps the source intact and reports the error to the user.
    await cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    await rm(source, { recursive: true });
  }
}

export function isCaseOnlyRename(
  source: string,
  destination: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" &&
    source !== destination &&
    path.win32.normalize(source).toLocaleLowerCase("en-US") ===
      path.win32.normalize(destination).toLocaleLowerCase("en-US")
  );
}

export async function operateProjectFile(
  folders: PineProjectFolder[],
  request: ProjectFileOperation,
  native: ProjectFileNativeActions,
): Promise<void> {
  const operation = ProjectFileOperationSchema.parse(request);
  const resolvedTarget = await resolveProjectEntry(folders, operation.target);
  if (operation.action === "open") {
    const error = await native.open(resolvedTarget);
    if (error) throw new Error(error);
    return;
  }
  if (operation.action === "reveal") return native.reveal(resolvedTarget);
  if (operation.action === "copy-path") return native.copyPath(resolvedTarget);

  await assertWritable(
    folders,
    resolvedTarget,
    operation.action === "trash" || operation.action === "rename",
  );
  if (operation.action === "trash") return native.trash(resolvedTarget);
  if (operation.action === "rename") {
    const destination = path.join(path.dirname(resolvedTarget), operation.name);
    if (destination === resolvedTarget) return;
    await assertWritable(folders, destination);
    await moveEntry(resolvedTarget, destination);
    return;
  }
  if (!(await lstat(resolvedTarget)).isDirectory())
    throw new Error("Drop files onto a folder.");
  if (operation.action === "create") {
    const destination = path.join(resolvedTarget, operation.name);
    await assertWritable(folders, destination);
    if (operation.kind === "directory") await mkdir(destination);
    else await writeFile(destination, "", { flag: "wx" });
    return;
  }

  if (operation.action !== "move" && operation.action !== "move-external")
    return;

  const sources =
    operation.action === "move"
      ? await Promise.all(
          operation.sources.map((entry) => resolveProjectEntry(folders, entry)),
        )
      : await Promise.all(
          operation.paths.map(async (source) => {
            if ((await lstat(source)).isSymbolicLink())
              throw new Error("Moving symbolic links is not supported.");
            return realpath(source);
          }),
        );
  const moves: { source: string; destination: string }[] = [];
  for (const source of new Set(sources)) {
    const metadata = await lstat(source);
    if (!metadata.isDirectory() && !metadata.isFile())
      throw new Error("Only files and folders can be moved.");
    await assertWritable(folders, source, true);
    if (contains(source, resolvedTarget))
      throw new Error("Cannot move a folder into itself.");
    const destination = path.join(resolvedTarget, path.basename(source));
    if (source === destination) continue;
    await assertWritable(folders, destination);
    await assertMissing(destination);
    if (moves.some((move) => move.destination === destination))
      throw new Error("The selected files have conflicting names.");
    moves.push({ source, destination });
  }
  if (
    moves.some((move) =>
      moves.some(
        (other) => other !== move && contains(other.source, move.source),
      ),
    )
  ) {
    throw new Error("Select either a folder or its contents, not both.");
  }
  // Validate the whole batch before making the first change.
  for (const move of moves) await moveEntry(move.source, move.destination);
}
