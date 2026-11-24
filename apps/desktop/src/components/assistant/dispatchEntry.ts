import { DISPATCH_TASK_TOOL_NAME } from "@/shared/assistant";
import type { PineSessionNotice, PineToolCall } from "@/shared/sessions";

/** One card of the Assistant's conversation about a session it dispatched. */
export interface AssistantDispatchEntry {
  /** Absent until the dispatch has started the session. */
  sessionId?: string;
  projectId: string;
  /** The project's name as the tool reported it, before the list has it. */
  projectName?: string;
  title?: string;
  state:
    | "dispatching"
    | "dispatched"
    | "dispatch-failed"
    | PineSessionNotice["state"];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function isDispatchToolCall(toolCall: PineToolCall): boolean {
  return toolCall.name === DISPATCH_TASK_TOOL_NAME;
}

/** A dispatch_task call as a card: what it asked for, then what it started. */
export function dispatchEntryOfToolCall(
  toolCall: PineToolCall,
): AssistantDispatchEntry {
  const input = record(toolCall.input);
  const details = record(record(toolCall.output).details);
  const sessionId = text(details.sessionId);
  const projectName = text(details.projectName);
  const title = text(input.title);
  return {
    projectId: text(details.projectId) ?? text(input.projectId) ?? "",
    ...(sessionId ? { sessionId } : {}),
    ...(projectName ? { projectName } : {}),
    ...(title ? { title } : {}),
    state:
      toolCall.status === "complete" && sessionId
        ? "dispatched"
        : toolCall.status === "error" || toolCall.status === "complete"
          ? "dispatch-failed"
          : "dispatching",
  };
}

/** A dispatched session's notice as a card. */
export function dispatchEntryOfNotice(
  notice: PineSessionNotice,
): AssistantDispatchEntry {
  return { ...notice };
}
