import { realpathSync } from "node:fs";
import path from "node:path";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  UI_PRESENT_FILE_TOOL_NAME,
  UI_SUBMIT_ARTIFACT_TOOL_NAME,
} from "../../shared/agent";

export const ARTIFACT_REMINDER_HEADING = "[Pine artifact note]";
const REMINDER_FOOTER = "Do not mention this note to the user.";

/**
 * Formats people usually open rather than run: documents, data, media. Source
 * code is left out so writing a project's code never prompts a submission.
 */
const DELIVERABLE_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".odt",
  ".rtf",
  ".pages",
  ".xls",
  ".xlsx",
  ".ods",
  ".numbers",
  ".csv",
  ".tsv",
  ".ppt",
  ".pptx",
  ".odp",
  ".key",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".epub",
  ".typ",
  ".tex",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp3",
  ".wav",
  ".m4a",
  ".mp4",
  ".mov",
  ".webm",
  ".drawio",
  ".excalidraw",
  ".xmind",
]);

export function isLikelyDeliverable(filePath: string): boolean {
  return DELIVERABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** The note for a rewrite of a file the session already submitted. */
export function buildRevisionReminder(filePath: string): string {
  return [
    ARTIFACT_REMINDER_HEADING,
    `${filePath} is one of this session's artifacts. When this revision is done, submit it again with ${UI_SUBMIT_ARTIFACT_TOOL_NAME} so the user keeps the new version, and present it with ${UI_PRESENT_FILE_TOOL_NAME}.`,
    REMINDER_FOOTER,
  ].join("\n");
}

/** The note for a new file in a format people usually open. */
export function buildNewFileReminder(filePath: string): string {
  return [
    ARTIFACT_REMINDER_HEADING,
    `If ${filePath} is something the user should look at or keep, submit it with ${UI_SUBMIT_ARTIFACT_TOOL_NAME} once it is finished and present it with ${UI_PRESENT_FILE_TOOL_NAME}. Ignore this for scratch, intermediate or project source files.`,
    REMINDER_FOOTER,
  ].join("\n");
}

function canonical(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function submittedPathsOf(details: unknown): string[] {
  const files = (details as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    const filePath = (file as { path?: unknown } | null)?.path;
    return typeof filePath === "string" && filePath ? [filePath] : [];
  });
}

/** Paths submitted anywhere on the branch, replayed from its tool results. */
export function replaySubmittedPaths(entries: Iterable<unknown>): Set<string> {
  const paths = new Set<string>();
  for (const entry of entries) {
    const candidate = entry as {
      type?: unknown;
      message?: {
        role?: unknown;
        toolName?: unknown;
        isError?: unknown;
        details?: unknown;
      };
    };
    const message = candidate.message;
    if (
      candidate.type !== "message" ||
      message?.role !== "toolResult" ||
      message.toolName !== UI_SUBMIT_ARTIFACT_TOOL_NAME ||
      message.isError === true
    )
      continue;
    for (const filePath of submittedPathsOf(message.details)) {
      paths.add(filePath);
    }
  }
  return paths;
}

/**
 * Appends a short note to a write or edit result when the file looks like
 * something the user should receive: a rewrite of a file the session already
 * submitted, or a new document or media file in the project. The note rides on
 * the tool result, so the system prompt and earlier messages stay unchanged.
 * Each kind of note appears at most once per run, a revision note once per
 * file, and nothing is said once the run has submitted that file.
 */
export function createArtifactRemindersExtension(options: {
  cwd: string;
}): InlineExtension {
  const cwd = canonical(options.cwd);
  return {
    name: "pine-artifact-reminders",
    factory: (pi) => {
      let submitted: Set<string> | undefined;
      let submittedThisRun = new Set<string>();
      let revisionNoted = new Set<string>();
      let newFileNoted = false;
      pi.on("agent_start", () => {
        submittedThisRun = new Set();
        revisionNoted = new Set();
        newFileNoted = false;
      });
      pi.on("tool_result", (event, ctx) => {
        if (event.isError) return;
        if (event.toolName === UI_SUBMIT_ARTIFACT_TOOL_NAME) {
          for (const filePath of submittedPathsOf(event.details)) {
            submitted?.add(filePath);
            submittedThisRun.add(filePath);
          }
          return;
        }
        if (
          (event.toolName !== "write" && event.toolName !== "edit") ||
          event.parentToolCallId ||
          !pi.getActiveTools().includes(UI_SUBMIT_ARTIFACT_TOOL_NAME)
        )
          return;
        const requested = event.input.path;
        if (typeof requested !== "string" || !requested) return;
        const filePath = canonical(path.resolve(cwd, requested));
        if (submittedThisRun.has(filePath)) return;
        submitted ??= replaySubmittedPaths(ctx.sessionManager.getBranch());
        let reminder: string | undefined;
        if (submitted.has(filePath)) {
          if (revisionNoted.has(filePath)) return;
          revisionNoted.add(filePath);
          reminder = buildRevisionReminder(requested);
        } else if (
          event.toolName === "write" &&
          !newFileNoted &&
          submittedThisRun.size === 0 &&
          isInside(cwd, filePath) &&
          isLikelyDeliverable(filePath)
        ) {
          newFileNoted = true;
          reminder = buildNewFileReminder(requested);
        }
        if (!reminder) return;
        return {
          content: [
            ...event.content,
            { type: "text", text: `\n\n${reminder}` },
          ],
          ...(event.structuredContent === undefined
            ? {}
            : { structuredContent: event.structuredContent }),
        };
      });
    },
  };
}
