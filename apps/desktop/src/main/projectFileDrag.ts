import type { NativeImage, WebContents } from "electron";
import { z } from "zod";

export type ProjectFileDragIconLoader = (
  filePath: string,
  options: { size: "normal" },
) => Promise<NativeImage>;

/**
 * Start an OS file drag with the icon associated with the file on the host.
 * Keeping this separate from the IPC handler makes the native drag contract
 * testable without importing the main process entry point.
 */
export async function startProjectFileDrag(
  sender: Pick<WebContents, "isDestroyed" | "startDrag">,
  filePath: string,
  loadIcon: ProjectFileDragIconLoader,
): Promise<void> {
  const icon = await loadIcon(filePath, { size: "normal" });
  if (sender.isDestroyed()) return;
  sender.startDrag({ file: filePath, icon });
}

export const StartPresentedFileDragSchema = z.object({
  path: z.string().min(1).max(4096),
});

/**
 * Start an OS file drag for a file presented to this window from outside the
 * project. `authorize` must resolve the path through this window's presented
 * grants, so the renderer can never drag an arbitrary path off the disk.
 */
export async function startPresentedFileDrag(
  sender: Pick<WebContents, "isDestroyed" | "startDrag">,
  request: unknown,
  authorize: (filePath: string) => Promise<string>,
  loadIcon: ProjectFileDragIconLoader,
): Promise<void> {
  const { path: requestedPath } = StartPresentedFileDragSchema.parse(request);
  const filePath = await authorize(requestedPath);
  if (sender.isDestroyed()) return;
  await startProjectFileDrag(sender, filePath, loadIcon);
}
