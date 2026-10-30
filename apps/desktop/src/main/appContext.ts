import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { nativeImage, systemPreferences } from "electron";
import type { AttachmentSource, PineAttachment } from "../shared/attachments";
import type { QuickComposerPermission } from "../shared/quickComposer";
import { loadNativeAddon } from "./nativeAddon";

/** The app the user was in, read before Pine takes focus. */
export interface FrontmostApp {
  name?: string;
  bundleId?: string;
  pid: number;
  /** Its frontmost window on screen. */
  windowId?: number;
}

interface AppFocus {
  windowTitle?: string;
  /** A file URL, or the page a browser shows. */
  document?: string;
  selectedText?: string;
}

/** native/app-context/app_context.m */
interface AppContextAddon {
  frontmostApp(): FrontmostApp | null;
  focus(pid: number): AppFocus | null;
}

export interface CapturedAppContext {
  attachments: PineAttachment[];
  missing: QuickComposerPermission[];
}

/** Screenshots are scaled down to this many pixels on their longer side. */
const MAX_SCREENSHOT_EDGE = 2048;
/** How much of a selection names its attachment. */
const SELECTION_NAME_LENGTH = 48;
const MAX_NAME_LENGTH = 120;

const execFileAsync = promisify(execFile);

function addon(): AppContextAddon | null {
  return loadNativeAddon<AppContextAddon>("app-context", "app_context");
}

/** Null when Pine is in front, or off macOS. */
export function frontmostApp(): FrontmostApp | null {
  try {
    return addon()?.frontmostApp() ?? null;
  } catch {
    return null;
  }
}

function sourceOf(app: FrontmostApp, focus: AppFocus | null): AttachmentSource {
  const source: AttachmentSource = { app: app.name || app.bundleId || "App" };
  if (app.bundleId) source.bundleId = app.bundleId;
  if (focus?.windowTitle) source.windowTitle = focus.windowTitle;
  const document = focus?.document;
  if (document?.startsWith("file://")) {
    try {
      source.documentPath = decodeURIComponent(new URL(document).pathname);
    } catch {
      // Not a path after all.
    }
  } else if (document && /^https?:\/\//i.test(document)) {
    source.url = document;
  }
  return source;
}

/** A file name that is one line and fits. */
function displayName(
  text: string,
  extension: string,
  length = MAX_NAME_LENGTH,
): string {
  const line = text.replace(/\s+/g, " ").trim().replaceAll("/", "∕");
  const name = line.length > length ? `${line.slice(0, length - 1)}…` : line;
  return `${name}.${extension}`;
}

async function attachment(
  filePath: string,
  name: string,
  extension: string,
  extra: Pick<PineAttachment, "selection" | "source">,
): Promise<PineAttachment> {
  const metadata = await stat(filePath);
  return {
    extension,
    kind: "file",
    modifiedAt: metadata.mtime.toISOString(),
    name,
    path: filePath,
    size: metadata.size,
    ...extra,
  };
}

/**
 * Takes the window with `screencapture`, which asks for Screen Recording the
 * first time. Without the permission it captures only the desktop behind,
 * so the image is kept only once the permission is there.
 */
async function captureWindow(
  windowId: number,
  directory: string,
): Promise<string | null> {
  const filePath = path.join(directory, `${randomUUID()}.png`);
  try {
    await execFileAsync("/usr/sbin/screencapture", [
      "-x",
      "-o",
      `-l${windowId}`,
      "-t",
      "png",
      filePath,
    ]);
    if (systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      await rm(filePath, { force: true });
      return null;
    }
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      await rm(filePath, { force: true });
      return null;
    }
    const { width, height } = image.getSize();
    const scale = MAX_SCREENSHOT_EDGE / Math.max(width, height);
    if (scale < 1)
      await writeFile(
        filePath,
        image
          .resize({
            width: Math.round(width * scale),
            height: Math.round(height * scale),
            quality: "best",
          })
          .toPNG(),
      );
    return filePath;
  } catch {
    await rm(filePath, { force: true }).catch(() => undefined);
    return null;
  }
}

/** Deletes the files of context that was never sent. */
export async function discardAppContext(
  attachments: readonly PineAttachment[],
): Promise<void> {
  await Promise.all(
    attachments.map((attachment) =>
      rm(attachment.path, { force: true }).catch(() => undefined),
    ),
  );
}

/**
 * A screenshot of the app's window and the text selected in it, saved in
 * `directory`. What a missing permission keeps out is listed instead.
 */
export async function captureAppContext(
  app: FrontmostApp,
  directory: string,
): Promise<CapturedAppContext> {
  const missing: QuickComposerPermission[] = [];
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  if (!trusted) missing.push("accessibility");
  let focus: AppFocus | null = null;
  try {
    focus = trusted ? (addon()?.focus(app.pid) ?? null) : null;
  } catch {
    focus = null;
  }
  const source = sourceOf(app, focus);
  await mkdir(directory, { recursive: true });

  const attachments: PineAttachment[] = [];
  const screenAccess = systemPreferences.getMediaAccessStatus("screen");
  if (screenAccess === "denied" || screenAccess === "restricted")
    missing.push("screen");
  else if (app.windowId) {
    const screenshot = await captureWindow(app.windowId, directory);
    if (screenshot)
      attachments.push(
        await attachment(
          screenshot,
          displayName(source.windowTitle || source.app, "png"),
          "png",
          { source },
        ),
      );
    else if (systemPreferences.getMediaAccessStatus("screen") !== "granted")
      missing.push("screen");
  }

  const selectedText = focus?.selectedText;
  if (selectedText) {
    const filePath = path.join(directory, `${randomUUID()}.txt`);
    await writeFile(filePath, selectedText);
    const lines = selectedText.split(/\r\n|\r|\n/).length;
    attachments.push(
      await attachment(
        filePath,
        displayName(selectedText, "txt", SELECTION_NAME_LENGTH),
        "txt",
        {
          selection: {
            startLine: 1,
            endLine: lines,
            label: source.app,
            text: selectedText,
          },
          source,
        },
      ),
    );
  }
  return { attachments, missing };
}
