import type { ProjectEntryReference } from "@/shared/projectFiles";

export const PROJECT_ENTRY_DRAG_TYPE = "application/x-pine-project-entry";

export function containsFileDrag(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.types ?? []).some(
    (type) => type === "Files" || type === PROJECT_ENTRY_DRAG_TYPE,
  );
}

export function readProjectEntryDrag(
  transfer: DataTransfer,
): ProjectEntryReference[] | undefined {
  if (!Array.from(transfer.types).includes(PROJECT_ENTRY_DRAG_TYPE))
    return undefined;
  const value: unknown = JSON.parse(transfer.getData(PROJECT_ENTRY_DRAG_TYPE));
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    !value.every(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "folderId" in entry &&
        typeof entry.folderId === "string" &&
        "projectId" in entry &&
        typeof entry.projectId === "string" &&
        "relativePath" in entry &&
        typeof entry.relativePath === "string",
    )
  )
    throw new Error("Invalid project file drag.");
  return value as ProjectEntryReference[];
}

export function externalFilePaths(transfer: DataTransfer): string[] {
  return [
    ...new Set(
      Array.from(transfer.files)
        .map((file) => window.pine.getPathForFile(file))
        .filter(Boolean),
    ),
  ];
}
