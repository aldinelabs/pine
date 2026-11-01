import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { ProjectFileNativeActions } from "../main/projectFileOperations";

function unavailable(): never {
  throw new Error("This action is unavailable on a Pine server.");
}

/**
 * File actions without a desktop: the browser opens, reveals and copies by
 * itself, and moving to the trash keeps the file in the data directory's own
 * trash folder, where nothing deletes it.
 */
export function serverFileActions(
  trashDirectory: string,
): ProjectFileNativeActions {
  return {
    trash: async (filePath) => {
      const target = path.join(
        trashDirectory,
        `${randomUUID()}-${path.basename(filePath)}`,
      );
      await mkdir(trashDirectory, { recursive: true });
      try {
        await rename(filePath, target);
      } catch (error) {
        // A project folder on another volume cannot be renamed into it.
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        await cp(filePath, target, { recursive: true, verbatimSymlinks: true });
        await rm(filePath, { recursive: true });
      }
    },
    open: unavailable,
    reveal: unavailable,
    copyPath: unavailable,
  };
}
