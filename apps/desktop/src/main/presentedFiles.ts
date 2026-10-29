import { z } from "zod";
import type { ProjectFileNativeActions } from "./projectFileOperations";

/**
 * Per-window allowlist of absolute file paths the agent presented to the user.
 *
 * Project folders are already readable through the validated project-entry
 * channels, but a presented file can live anywhere (a download, an attachment,
 * a file the user just approved). Serving those paths needs the window to stay
 * inside what Pine can actually justify, so the renderer never gains a generic
 * "read any absolute path" capability: only paths recorded here — and only for
 * the window that presented them — resolve to file contents.
 *
 * Grants are intentionally per-run. A grant exists because the agent's call
 * passed Pine's access policy (or an explicit approval) in this session, and
 * that justification does not survive a restart, so restored tabs re-present
 * instead of silently re-reading the file.
 */
export const MAX_PRESENTED_FILES_PER_WINDOW = 64;

export class PresentedFileRegistry {
  private readonly byWindow = new Map<number, Set<string>>();

  /** Records an absolute, canonical path presented to one window. */
  remember(webContentsId: number, filePath: string): void {
    const existing = this.byWindow.get(webContentsId) ?? new Set<string>();
    // Re-inserting keeps the path at the newest position, so the bound below
    // evicts the least recently presented path rather than the oldest grant.
    existing.delete(filePath);
    existing.add(filePath);
    while (existing.size > MAX_PRESENTED_FILES_PER_WINDOW) {
      const oldest = existing.values().next().value;
      if (oldest === undefined) break;
      existing.delete(oldest);
    }
    this.byWindow.set(webContentsId, existing);
  }

  allows(webContentsId: number, filePath: string): boolean {
    return this.byWindow.get(webContentsId)?.has(filePath) ?? false;
  }

  forget(webContentsId: number): void {
    this.byWindow.delete(webContentsId);
  }
}

export const PresentedFileOperationSchema = z.object({
  action: z.enum(["open", "reveal", "copy-path"]),
  path: z.string().min(1).max(4096),
});

/**
 * Run a read-only native action on a presented file. `authorize` must resolve
 * the requested path through this window's grants, so the action can only
 * reach a file the agent actually presented here.
 */
export async function operatePresentedFile(
  request: unknown,
  authorize: (filePath: string) => Promise<string>,
  native: Pick<ProjectFileNativeActions, "open" | "reveal" | "copyPath">,
): Promise<void> {
  const operation = PresentedFileOperationSchema.parse(request);
  const filePath = await authorize(operation.path);
  if (operation.action === "open") {
    const error = await native.open(filePath);
    if (error) throw new Error(error);
    return;
  }
  if (operation.action === "reveal") return native.reveal(filePath);
  return native.copyPath(filePath);
}
