import { isWebClient } from "@/lib/clientRuntime";
import type {
  FilePreviewTarget,
  ProjectEntryReference,
} from "@/shared/projectFiles";

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

/**
 * Start dragging a project entry from a dragstart event. The drag carries the
 * entry, so Pine's composer and file tree know where it came from; on the
 * desktop it becomes a native file drag that Finder and other apps accept,
 * after the main process resolves the entry inside this window's project.
 */
export function dragProjectEntry(
  event: DragEvent,
  entry: ProjectEntryReference,
): void {
  if (!event.dataTransfer) {
    event.preventDefault();
    return;
  }
  event.dataTransfer.setData(PROJECT_ENTRY_DRAG_TYPE, JSON.stringify([entry]));
  // Even read-only entries can be attached to a message.
  event.dataTransfer.effectAllowed = "copyMove";
  if (isWebClient()) return;
  event.preventDefault();
  window.pine.startProjectFileDrag(entry);
}

/**
 * Start dragging a previewed file: a project file drags like an entry from the
 * file tree. A presented file outside the project only drags natively, after
 * the main process checks it against this window's presented grants, so the
 * web client cancels it.
 */
export function dragFileTarget(
  event: DragEvent,
  target: FilePreviewTarget,
): void {
  if (target.source === "project") {
    dragProjectEntry(event, {
      folderId: target.folderId,
      projectId: target.projectId,
      relativePath: target.relativePath,
    });
    return;
  }
  event.preventDefault();
  startNativeFileDrag(target);
}

/**
 * Start a native file drag without a dragstart event, for a file resolved
 * only after the browser drag had to be cancelled. Does nothing on the web.
 */
export function startNativeFileDrag(target: FilePreviewTarget): void {
  if (isWebClient()) return;
  if (target.source === "project")
    window.pine.startProjectFileDrag({
      folderId: target.folderId,
      projectId: target.projectId,
      relativePath: target.relativePath,
    });
  else window.pine.startPresentedFileDrag({ path: target.path });
}
