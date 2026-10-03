import type { PineAgentEvent, PineAgentRunState } from "../shared/agent";
import {
  contentBlocksToText,
  parseMessageBlocks,
  transcriptRole,
} from "../shared/sessions";

/** A session that just finished its own run and should signal the user. */
export interface PineCompletedRun {
  sessionId: string;
  /** Visible text of the final assistant message, without thinking. */
  text: string;
}

/**
 * Watches agent events and reports when a session stops iterating on its own.
 *
 * Only a `running` → `idle` transition counts: a user abort passes through
 * `aborting` first, and failures end in `failed`, so neither signals. Repeated
 * idle events for the same run are ignored because the state is already idle.
 */
export class CompletionSignalTracker {
  private readonly states = new Map<string, PineAgentRunState>();
  private readonly lastAssistantText = new Map<string, string>();

  observe(event: PineAgentEvent): PineCompletedRun | undefined {
    if (event.type === "message-end") {
      if (transcriptRole(event.message) !== "assistant") return undefined;
      const text = assistantText(event.message);
      if (text) this.lastAssistantText.set(event.sessionId, text);
      return undefined;
    }
    if (event.type !== "run-state") return undefined;

    const previous = this.states.get(event.sessionId);
    this.states.set(event.sessionId, event.state);
    if (event.state === "running" && previous !== "running") {
      this.lastAssistantText.delete(event.sessionId);
      return undefined;
    }
    if (event.state !== "idle" || previous !== "running") return undefined;
    return {
      sessionId: event.sessionId,
      text: this.lastAssistantText.get(event.sessionId) ?? "",
    };
  }

  forget(sessionId: string): void {
    this.states.delete(sessionId);
    this.lastAssistantText.delete(sessionId);
  }
}

function assistantText(message: unknown): string {
  return contentBlocksToText(parseMessageBlocks(message)).trim();
}
