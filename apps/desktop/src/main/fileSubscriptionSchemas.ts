import { z } from "zod";
import { ProjectEntryReferenceSchema } from "./projectFileOperations";
import {
  MAX_WATCHED_PROJECT_FOLDERS,
  MAX_WATCHED_PROJECT_DIRECTORIES,
} from "../shared/projectFiles";

export const SetWatchedProjectDirectoriesRequestSchema = z.object({
  folders: z
    .array(
      z.object({
        folderId: z.uuid(),
        projectId: z.uuid(),
        directories: z.array(z.string().max(4_096)),
      }),
    )
    .max(MAX_WATCHED_PROJECT_FOLDERS)
    .refine(
      (folders) =>
        new Set(
          folders.map((folder) => `${folder.projectId}/${folder.folderId}`),
        ).size === folders.length,
      "Folder IDs must be unique.",
    )
    .refine(
      (folders) =>
        folders.reduce(
          (total, folder) => total + folder.directories.length,
          0,
        ) <= MAX_WATCHED_PROJECT_DIRECTORIES,
      `At most ${MAX_WATCHED_PROJECT_DIRECTORIES} directories can be watched.`,
    ),
});

export const SetWatchedFilePreviewRequestSchema = z.object({
  watchId: z.string().min(1).max(200),
  target: z
    .discriminatedUnion("source", [
      ProjectEntryReferenceSchema.extend({ source: z.literal("project") }),
      z.object({
        source: z.literal("presented"),
        path: z.string().min(1).max(4096),
      }),
    ])
    .nullable(),
});
