import type {
  PineAssistantMessageUpdate,
  PineSessionEvent,
} from "../shared/agent";
import type { WebSessionSnapshot } from "../shared/webControl";

interface MessageState {
  event: Extract<PineSessionEvent, { type: "message-start" | "message-end" }>;
  blocks: Map<number, PineAssistantMessageUpdate>;
}

interface SessionState {
  projectId: string;
  values: Map<string, PineSessionEvent>;
  messages: Map<string, MessageState>;
}

/** Compact live state, independent of network connections and persisted history. */
export class WebSessionState {
  private readonly sessions = new Map<string, SessionState>();

  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  observe(projectId: string, event: PineSessionEvent): void {
    const state = this.sessions.get(event.sessionId) ?? {
      projectId,
      values: new Map(),
      messages: new Map(),
    };
    state.projectId = projectId;
    this.sessions.set(event.sessionId, state);
    const previousRun = state.values.get("run-state");
    if (
      event.type === "run-state" &&
      event.state === "running" &&
      previousRun?.type === "run-state" &&
      (previousRun.state === "idle" || previousRun.state === "failed")
    ) {
      state.messages.clear();
      for (const key of state.values.keys())
        if (/^(tool|decision|review):/.test(key)) state.values.delete(key);
    }
    if (event.type === "message-start" || event.type === "message-end") {
      state.messages.set(event.messageId, { event, blocks: new Map() });
      // Closed messages are recoverable from history; retain only recent ones.
      if (state.messages.size > 100) {
        const oldest = [...state.messages].find(
          ([, message]) => message.event.type === "message-end",
        );
        if (oldest) state.messages.delete(oldest[0]);
      }
      return;
    }
    if (event.type === "message-update") {
      const message = state.messages.get(event.messageId);
      if (!message) return;
      for (const update of event.updates) {
        const previous = message.blocks.get(update.contentIndex);
        if (update.type === "text-delta") {
          const text = previous && "text" in previous ? previous.text : "";
          message.blocks.set(update.contentIndex, {
            type: "text-start",
            contentIndex: update.contentIndex,
            text: text + update.delta,
          });
        } else if (update.type === "thinking-delta") {
          const thinking =
            previous && "thinking" in previous ? previous.thinking : "";
          message.blocks.set(update.contentIndex, {
            type: "thinking-start",
            contentIndex: update.contentIndex,
            thinking: thinking + update.delta,
          });
        } else if (update.type === "tool-call-delta") {
          if (previous && "id" in previous && update.input !== undefined)
            message.blocks.set(update.contentIndex, {
              ...previous,
              input: update.input,
            });
        } else message.blocks.set(update.contentIndex, update);
      }
      return;
    }
    if (event.type === "approval-decided")
      state.values.delete(`approval:${event.requestId}`);
    if (event.type === "questionnaire-decided")
      state.values.delete(`questionnaire:${event.requestId}`);
    if (
      event.type === "tool-end" ||
      event.type === "approval-request" ||
      event.type === "approval-decided"
    )
      state.values.delete(`review:${event.toolCallId}`);
    if (
      event.type === "run-state" &&
      (event.state === "idle" || event.state === "failed")
    ) {
      for (const key of state.values.keys())
        if (/^(approval|questionnaire|review):/.test(key))
          state.values.delete(key);
    }
    if (
      event.type !== "workbench-state-request" &&
      event.type !== "questionnaire-decided"
    )
      state.values.set(eventKey(event), event);
  }

  snapshots(
    liveProject: (sessionId: string) => string | undefined,
  ): WebSessionSnapshot[] {
    const snapshots: WebSessionSnapshot[] = [];
    for (const [sessionId, state] of this.sessions) {
      const projectId = liveProject(sessionId);
      if (!projectId) {
        this.sessions.delete(sessionId);
        continue;
      }
      const events: PineSessionEvent[] = [];
      const runState = state.values.get("run-state");
      if (runState) events.push(runState);
      for (const message of state.messages.values()) {
        events.push(message.event);
        if (message.blocks.size)
          events.push({
            type: "message-update",
            sessionId,
            messageId: message.event.messageId,
            updates: [...message.blocks.values()].sort(
              (a, b) => a.contentIndex - b.contentIndex,
            ),
          });
      }
      events.push(
        ...[...state.values.values()].filter((event) => event !== runState),
      );
      snapshots.push({ sessionId, projectId, events });
    }
    return snapshots;
  }
}

function eventKey(event: PineSessionEvent): string {
  switch (event.type) {
    case "approval-request":
      return `approval:${event.requestId}`;
    case "questionnaire-request":
      return `questionnaire:${event.requestId}`;
    case "tool-review":
      return `review:${event.toolCallId}`;
    case "tool-start":
    case "tool-update":
    case "tool-end":
      return `tool:${event.toolCallId}`;
    case "approval-decided":
      return `decision:${event.toolCallId}`;
    case "present-file":
      return `file:${event.toolCallId}`;
    case "workbench-command":
      return `workbench:${event.toolCallId}`;
    default:
      return event.type;
  }
}
