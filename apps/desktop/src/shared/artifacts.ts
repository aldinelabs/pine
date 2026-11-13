import {
  UI_PRESENT_FILE_TOOL_NAME,
  UI_SUBMIT_ARTIFACT_TOOL_NAME,
} from "./agent";
import type { PineToolCall } from "./sessions";

/**
 * A session artifact: a deliverable the agent submitted with
 * `ui_submit_artifact`, or (for sessions from before that tool existed) a
 * file it presented with `ui_present_file`.
 */
export interface SessionArtifact {
  toolCallId: string;
  /** The absolute path the tool result recorded. */
  path: string;
  title?: string;
  description?: string;
  /** True for a submitted file, false for a legacy presentation. */
  submitted: boolean;
}

/** Most files one `ui_submit_artifact` call accepts. */
export const MAX_SUBMITTED_ARTIFACTS = 50;

/**
 * Key for target and removal maps: the tool call id for a presentation, the
 * tool call id and path for a submitted file (one call submits many files).
 */
export function artifactKey(toolCallId: string, path?: string): string {
  return path ? `${toolCallId}\n${path}` : toolCallId;
}

function detailsOf(call: PineToolCall): Record<string, unknown> | undefined {
  if (typeof call.output !== "object" || call.output === null) return undefined;
  const details = (call.output as { details?: unknown }).details;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Accepted files of a complete `ui_submit_artifact` call, in the order given; [] otherwise. */
export function submittedArtifactsOfCall(
  call: PineToolCall,
): SessionArtifact[] {
  if (call.name !== UI_SUBMIT_ARTIFACT_TOOL_NAME || call.status !== "complete")
    return [];
  const files = detailsOf(call)?.files;
  if (!Array.isArray(files)) return [];
  const artifacts: SessionArtifact[] = [];
  for (const file of files) {
    if (typeof file !== "object" || file === null) continue;
    const record = file as Record<string, unknown>;
    if (typeof record.path !== "string" || !record.path) continue;
    const title = optionalText(record.title);
    const description = optionalText(record.description);
    artifacts.push({
      toolCallId: call.id,
      path: record.path,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      submitted: true,
    });
  }
  return artifacts;
}

/**
 * A presentation from before `ui_submit_artifact` existed: a complete
 * `ui_present_file` call whose details lack `artifact: false`.
 */
export function legacyPresentedArtifactOfCall(
  call: PineToolCall,
): SessionArtifact | null {
  if (call.name !== UI_PRESENT_FILE_TOOL_NAME || call.status !== "complete")
    return null;
  const details = detailsOf(call);
  if (details?.artifact === false) return null;
  const input =
    typeof call.input === "object" && call.input !== null
      ? (call.input as { path?: unknown })
      : undefined;
  const path =
    typeof details?.path === "string" && details.path
      ? details.path
      : typeof input?.path === "string" && input.path.trim()
        ? input.path.trim()
        : null;
  return path ? { toolCallId: call.id, path, submitted: false } : null;
}

/** The artifacts of one message's (or any list's) tool calls. */
export interface CallArtifacts {
  /**
   * Submitted files in collection order: calls in transcript order, each
   * call's files reversed, so `collectArtifacts` keeps a batch's own order.
   */
  submitted: readonly SessionArtifact[];
  legacy: readonly SessionArtifact[];
  /**
   * A completed submission that accepted a file. A running or failed one does
   * not count, so the list switches from legacy to submitted in one step.
   */
  hasSubmission: boolean;
}

export function artifactsOfCalls(calls: Iterable<PineToolCall>): CallArtifacts {
  const submitted: SessionArtifact[] = [];
  const legacy: SessionArtifact[] = [];
  let hasSubmission = false;
  for (const call of calls) {
    if (call.name === UI_SUBMIT_ARTIFACT_TOOL_NAME) {
      const files = submittedArtifactsOfCall(call);
      if (files.length > 0) hasSubmission = true;
      for (let index = files.length - 1; index >= 0; index -= 1)
        submitted.push(files[index]);
      continue;
    }
    const presented = legacyPresentedArtifactOfCall(call);
    if (presented) legacy.push(presented);
  }
  return { submitted, legacy, hasSubmission };
}

/**
 * The session's artifacts, newest first and one per path. Once any submission
 * exists only submitted files count; otherwise presentations recorded before
 * `ui_submit_artifact` existed do, so older sessions keep their list.
 *
 * The renderer passes only the loaded transcript pages: a session continued
 * across the upgrade whose submissions are all in unloaded pages lists its
 * pre-upgrade presentations until those pages load.
 */
export function collectArtifacts(
  chunks: Iterable<CallArtifacts>,
): SessionArtifact[] {
  const list = [...chunks];
  const useSubmitted = list.some((chunk) => chunk.hasSubmission);
  const byPath = new Map<string, SessionArtifact>();
  for (const chunk of list) {
    for (const artifact of useSubmitted ? chunk.submitted : chunk.legacy) {
      byPath.delete(artifact.path);
      byPath.set(artifact.path, artifact);
    }
  }
  return [...byPath.values()].reverse();
}
