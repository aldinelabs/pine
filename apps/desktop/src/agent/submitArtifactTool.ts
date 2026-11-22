import { stat } from "node:fs/promises";
import path from "node:path";
import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  UI_PRESENT_FILE_TOOL_NAME,
  UI_SUBMIT_ARTIFACT_TOOL_NAME,
  type PineApprovalMode,
} from "../shared/agent";
import {
  MAX_SUBMITTED_ARTIFACTS,
  normalizeArtifactFolder,
  type ArtifactSnapshot,
} from "../shared/artifacts";
import { snapshotFile, submissionEntryKey } from "./artifactStore";
import type { PineToolAccessPolicy } from "./tool-access-policy";

// Pine passes its own system prompt, so pi does not render promptSnippet or
// promptGuidelines: the description has to carry the guidance by itself.
const DESCRIPTION = [
  "Register files as this session's artifacts: the deliverables the user asked for, listed in the workbench Artifacts panel (and offered by the WeChat `.files` command). Submitting does not open or preview anything.",
  "",
  `- When your work produces deliverables, submit all of them in one call with every file in \`files\` before you end that turn, and in the same step call ${UI_PRESENT_FILE_TOOL_NAME} in parallel for the single most significant one (the file the user most likely wants to see first). Naming a path in your reply does not show the file to the user.`,
  `- Submit only finished results the user would keep: reports, documents, data, generated media, code they asked for. Do not submit intermediate files, scratch outputs, logs, or files you only present to show progress or a comparison; use ${UI_PRESENT_FILE_TOOL_NAME} alone for those.`,
  "- Every submission keeps a copy of each file as a version the user can preview, compare with the current file and restore. Whenever you finish revising a deliverable (changes the user asked for, a new draft, a substantial rewrite), submit it again in that turn so the user gets that version; do not resubmit unchanged files or after each intermediate edit.",
  "- Submitting a path again also updates its title and description and moves it to the top.",
  "- Paths must be files inside the folders shared with Pine or the user's attachments; save or copy a deliverable into a shared folder first. Directories and missing files are rejected per file, and the result lists what was accepted and rejected.",
  "- title (short) and description (one line) are optional and shown in the Artifacts list.",
  "- folder files the deliverable under a folder of the Artifacts list, nested with `/` (for example `Reports/Week 1`); it only groups the list and does not move the file. When a session has many deliverables, or several kinds of them, give each a folder by topic or kind and reuse the same names; leave it out for one or two files. A resubmission without folder stays where it was; pass an empty string to move it to the top level.",
].join("\n");

const submitArtifactParams = Type.Object({
  files: Type.Array(
    Type.Object({
      path: Type.String({
        minLength: 1,
        description:
          "Project-relative path preferred; absolute for attachments.",
      }),
      title: Type.Optional(
        Type.String({
          maxLength: 120,
          description: "Short name shown instead of the file name.",
        }),
      ),
      description: Type.Optional(
        Type.String({
          maxLength: 500,
          description: "One line on what the file is.",
        }),
      ),
      folder: Type.Optional(
        Type.String({
          maxLength: 200,
          description:
            'Artifacts list folder, nested with `/`; "" for the top level.',
        }),
      ),
    }),
    {
      minItems: 1,
      maxItems: MAX_SUBMITTED_ARTIFACTS,
      description: "Every deliverable of this step, most significant first.",
    },
  ),
});

type SubmitArtifactParams = Static<typeof submitArtifactParams>;

export interface SubmittedArtifactDetail {
  path: string;
  requestedPath: string;
  title?: string;
  description?: string;
  /** The Artifacts folder given ("" for the top level); absent when none was. */
  folder?: string;
  /** The copy kept of the file; absent when the session has no version store. */
  snapshot?: ArtifactSnapshot;
}

export interface SubmitArtifactDetails {
  files: SubmittedArtifactDetail[];
  rejected: { path: string; reason: string }[];
}

export interface SubmitArtifactToolOptions {
  cwd: string;
  policy: PineToolAccessPolicy;
  permissivePolicy: PineToolAccessPolicy;
  getApprovalMode: () => PineApprovalMode;
  /** The project's version store; without it submissions keep no copies. */
  versionStore?: string;
  /** Overrides the largest file a submission copies, for tests. */
  snapshotLimit?: number;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function folderLabel(folder: string | undefined): string {
  if (folder === undefined) return "";
  return folder ? ` [${folder}/]` : " [top level]";
}

/**
 * Records files as the session's artifacts. It only checks the metadata of
 * paths the access policy already allows, so it needs no approval: a path
 * outside the shared folders is rejected for that file instead of prompting
 * once per file. YOLO uses the permissive policy, as presenting does.
 */
export function createSubmitArtifactToolDefinition(
  options: SubmitArtifactToolOptions,
): ToolDefinition {
  return defineTool({
    name: UI_SUBMIT_ARTIFACT_TOOL_NAME,
    label: "Submit Artifact",
    description: DESCRIPTION,
    promptSnippet: `Use ${UI_SUBMIT_ARTIFACT_TOOL_NAME} to register the session's deliverables in one batch`,
    promptGuidelines: [
      `Submit every deliverable in one ${UI_SUBMIT_ARTIFACT_TOOL_NAME} call and, in the same step, call ${UI_PRESENT_FILE_TOOL_NAME} in parallel for the most significant one`,
      `Never submit intermediate, scratch, or comparison files; present those with ${UI_PRESENT_FILE_TOOL_NAME} alone`,
    ],
    parameters: submitArtifactParams,
    prepareArguments: (args) => args as SubmitArtifactParams,
    execute: async (toolCallId, inputParams, signal, _onUpdate, context) => {
      const policy =
        options.getApprovalMode() === "YOLO"
          ? options.permissivePolicy
          : options.policy;
      const accepted = new Map<string, SubmittedArtifactDetail>();
      const rejected: SubmitArtifactDetails["rejected"] = [];
      for (const file of inputParams.files) {
        if (signal?.aborted) throw new Error("aborted");
        const requested = file.path.trim();
        if (!requested) {
          rejected.push({ path: file.path, reason: "empty path" });
          continue;
        }
        let authorized: string;
        try {
          authorized = await policy.authorize(
            path.resolve(options.cwd, requested),
            "read",
          );
        } catch (error) {
          rejected.push({
            path: requested,
            reason:
              (error as NodeJS.ErrnoException)?.code === "ENOENT"
                ? "file not found"
                : error instanceof Error
                  ? error.message
                  : String(error),
          });
          continue;
        }
        const metadata = await stat(authorized).catch(() => null);
        if (!metadata?.isFile()) {
          rejected.push({
            path: requested,
            reason: metadata ? "not a regular file" : "file not found",
          });
          continue;
        }
        const title = trimmed(file.title);
        const description = trimmed(file.description);
        const folder =
          file.folder === undefined
            ? undefined
            : normalizeArtifactFolder(file.folder);
        // A path given twice keeps its first position and the last labels.
        const previous = accepted.get(authorized);
        accepted.set(authorized, {
          path: authorized,
          requestedPath: previous?.requestedPath ?? requested,
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(folder !== undefined ? { folder } : {}),
        });
      }
      const files = [...accepted.values()];
      const sessionId = context?.sessionManager?.getSessionId();
      if (options.versionStore && sessionId) {
        const store = options.versionStore;
        const time = Date.now();
        // One file at a time: a batch of large files would otherwise be read
        // into memory together.
        for (const file of files) {
          file.snapshot = await snapshotFile(
            store,
            submissionEntryKey(sessionId, toolCallId, file.path),
            file.path,
            {
              kind: "submission",
              sessionId,
              path: file.path,
              time,
              toolCallId,
            },
            options.snapshotLimit,
          );
        }
      }
      const rejectedText = rejected
        .map(({ path: requested, reason }) => `- ${requested}: ${reason}`)
        .join("\n");
      if (!files.length) {
        throw new Error(`No file was submitted.\n${rejectedText}`);
      }
      const acceptedText = files
        .map(
          ({ path: file, title, folder }) =>
            `- ${file}${title ? ` — ${title}` : ""}${folderLabel(folder)}`,
        )
        .join("\n");
      const details: SubmitArtifactDetails = { files, rejected };
      return {
        content: [
          {
            type: "text" as const,
            text: `Submitted ${files.length} file(s) to the session's artifacts:\n${acceptedText}${
              rejected.length
                ? `\nRejected ${rejected.length}:\n${rejectedText}`
                : ""
            }\nSubmitting does not open a preview; present the most significant file with ${UI_PRESENT_FILE_TOOL_NAME}.`,
          },
        ],
        details,
      };
    },
  });
}
