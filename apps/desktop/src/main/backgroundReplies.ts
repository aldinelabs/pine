import type { PineAgentEvent } from "../shared/agent";
import type { PineCompletedRun } from "./completionSignal";

/** How a session sent from the quick composer in the background ended. */
export type BackgroundReplyOutcome =
  | { kind: "answered"; sessionId: string; text: string }
  | { kind: "failed"; sessionId: string };

/**
 * Sessions whose answer the user asked to hear about: a message sent from
 * the quick composer with Control+Enter runs out of sight, so its end is
 * always told, once.
 */
export class BackgroundReplies {
  private readonly awaited = new Set<string>();

  watch(sessionId: string): void {
    this.awaited.add(sessionId);
  }

  /**
   * `completed` is what the completion tracker made of the same event. A run
   * the user stopped themselves ends quietly.
   */
  observe(
    event: PineAgentEvent,
    completed: PineCompletedRun | undefined,
  ): BackgroundReplyOutcome | undefined {
    if (completed && this.awaited.delete(completed.sessionId))
      return {
        kind: "answered",
        sessionId: completed.sessionId,
        text: completed.text,
      };
    if (event.type !== "run-state" || !this.awaited.has(event.sessionId))
      return undefined;
    if (event.state === "failed") {
      this.awaited.delete(event.sessionId);
      return { kind: "failed", sessionId: event.sessionId };
    }
    if (event.state === "idle") this.awaited.delete(event.sessionId);
    return undefined;
  }

  forget(sessionId: string): void {
    this.awaited.delete(sessionId);
  }
}
