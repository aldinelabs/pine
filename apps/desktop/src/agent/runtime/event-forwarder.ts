import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import {
  isSandboxDeniedPayload,
  type PineAgentEvent,
  type PineAssistantMessageUpdate,
} from "../../shared/agent";
import type {
  PineApprovalDecision,
  PineContextUsage,
} from "../../shared/sessions";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { toPineJsonValue } from "../protocol";
import {
  AssistantMessageUpdateCompactor,
  coalesceAssistantMessageUpdates,
} from "../messageStream";
import { sessionSummary } from "./session-state";
import type { LiveAgentSession } from "./session-state";

const MESSAGE_UPDATE_BATCH_MS = 120;

interface PendingMessageUpdates {
  messageId: string;
  timer: ReturnType<typeof setTimeout>;
  updates: PineAssistantMessageUpdate[];
}

export interface PineAgentEventForwarderOptions {
  emit: (event: PineAgentEvent) => void;
  getLiveSession: (sessionId: string) => LiveAgentSession | undefined;
  getSession: (sessionId: string) => LiveAgentSession;
  emitSteeringQueue: (live: LiveAgentSession) => void;
  recordApprovalDecision: (
    live: LiveAgentSession,
    decision: PineApprovalDecision,
  ) => void;
  generateInitialTitle: (live: LiveAgentSession) => Promise<void>;
  getContextUsage: (
    session: AgentSession,
    currentAssistantMessage?: AssistantMessage,
  ) => PineContextUsage | undefined;
  emitContextUsage: (
    session: AgentSession,
    contextUsage?: PineContextUsage,
  ) => void;
}

/** Converts Pi session events into renderer events and batches streamed deltas. */
export class PineAgentEventForwarder {
  private readonly activeMessageIds = new Map<string, string>();
  private readonly messageUpdateCompactors = new Map<
    string,
    { messageId: string; compactor: AssistantMessageUpdateCompactor }
  >();
  private readonly pendingMessageUpdates = new Map<
    string,
    PendingMessageUpdates
  >();
  private readonly activeCompactionIds = new Map<string, string>();

  constructor(private readonly options: PineAgentEventForwarderOptions) {}

  clearSession(sessionId: string): void {
    this.activeMessageIds.delete(sessionId);
    this.messageUpdateCompactors.delete(sessionId);
    this.clearPendingMessageUpdates(sessionId);
    this.activeCompactionIds.delete(sessionId);
  }

  forward(session: AgentSession, event: AgentSessionEvent): void {
    const sessionId = session.sessionId;
    switch (event.type) {
      case "message_start":
      case "message_end": {
        const messageId =
          event.type === "message_start"
            ? randomUUID()
            : (this.activeMessageIds.get(sessionId) ?? randomUUID());
        if (event.type === "message_start") {
          this.clearPendingMessageUpdates(sessionId);
          this.activeMessageIds.set(sessionId, messageId);
          this.messageUpdateCompactors.set(sessionId, {
            messageId,
            compactor: new AssistantMessageUpdateCompactor(),
          });
        } else {
          this.flushPendingMessageUpdates(sessionId);
          this.activeMessageIds.delete(sessionId);
          this.messageUpdateCompactors.delete(sessionId);
        }
        this.options.emit({
          type:
            event.type === "message_start" ? "message-start" : "message-end",
          sessionId,
          messageId,
          message: toPineJsonValue(event.message),
        });
        if (event.type === "message_end") {
          this.options.emitContextUsage(
            session,
            this.options.getContextUsage(
              session,
              event.message.role === "assistant" ? event.message : undefined,
            ),
          );
        }
        break;
      }
      case "message_update": {
        const messageId = this.activeMessageIds.get(sessionId) ?? randomUUID();
        let stream = this.messageUpdateCompactors.get(sessionId);
        if (!stream || stream.messageId !== messageId) {
          stream = {
            messageId,
            compactor: new AssistantMessageUpdateCompactor(),
          };
          this.messageUpdateCompactors.set(sessionId, stream);
        }
        const update = stream.compactor.compact(event.assistantMessageEvent);
        if (update) this.queueMessageUpdate(sessionId, messageId, update);
        break;
      }
      case "queue_update": {
        const live = this.options.getLiveSession(sessionId);
        if (live) this.options.emitSteeringQueue(live);
        break;
      }
      case "tool_execution_start":
        this.flushPendingMessageUpdates(sessionId);
        this.options.emit({
          type: "tool-start",
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          payload: toPineJsonValue(event.args),
        });
        break;
      case "tool_execution_update":
        this.options.emit({
          type: "tool-update",
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          payload: toPineJsonValue(event.partialResult),
        });
        break;
      case "tool_execution_end": {
        const payload = toPineJsonValue(event.result);
        if (event.isError && isSandboxDeniedPayload(payload)) {
          this.options.recordApprovalDecision(
            this.options.getSession(sessionId),
            {
              requestId: `sandbox-${event.toolCallId}`,
              toolCallId: event.toolCallId,
              verdict: "denied",
              decidedBy: "sandbox",
            },
          );
        }
        this.options.emit({
          type: "tool-end",
          sessionId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          payload,
          isError: event.isError,
        });
        break;
      }
      case "compaction_start": {
        const compactionId = randomUUID();
        this.activeCompactionIds.set(sessionId, compactionId);
        this.options.emit({ type: "run-state", sessionId, state: "running" });
        this.options.emit({
          type: "compaction-start",
          sessionId,
          compactionId,
        });
        break;
      }
      case "compaction_end": {
        const compactionId =
          this.activeCompactionIds.get(sessionId) ?? randomUUID();
        this.activeCompactionIds.delete(sessionId);
        this.options.emit({
          type: "compaction-end",
          sessionId,
          compactionId,
          status: event.result
            ? "complete"
            : event.aborted
              ? "aborted"
              : "error",
        });
        if (!event.aborted && !event.result && event.errorMessage) {
          this.options.emit({
            type: "session-error",
            sessionId,
            errorId: randomUUID(),
            message: event.errorMessage,
          });
        }
        this.options.emitContextUsage(session);
        if (
          session.isIdle &&
          !this.options.getLiveSession(sessionId)?.resumingCompactionPrompts
        ) {
          this.options.emit({ type: "run-state", sessionId, state: "idle" });
        }
        break;
      }
      case "auto_retry_end":
        if (!event.success) {
          this.options.emit({
            type: "session-error",
            sessionId,
            errorId: randomUUID(),
            message: `Retry failed after ${event.attempt} attempts: ${event.finalError ?? "Unknown error"}`,
          });
        }
        break;
      case "entry_appended":
      case "session_info_changed":
        this.options.emit({
          type: "session-updated",
          sessionId,
          summary: sessionSummary(session),
        });
        break;
      case "agent_settled":
        void this.options.generateInitialTitle(
          this.options.getSession(sessionId),
        );
        break;
      default:
        break;
    }
  }

  private queueMessageUpdate(
    sessionId: string,
    messageId: string,
    update: PineAssistantMessageUpdate,
  ): void {
    const pending = this.pendingMessageUpdates.get(sessionId);
    if (pending && pending.messageId === messageId) {
      pending.updates.push(update);
      return;
    }
    if (pending) this.flushPendingMessageUpdates(sessionId);

    const timer = setTimeout(() => {
      this.flushPendingMessageUpdates(sessionId);
    }, MESSAGE_UPDATE_BATCH_MS);
    this.pendingMessageUpdates.set(sessionId, {
      messageId,
      timer,
      updates: [update],
    });
  }

  private flushPendingMessageUpdates(sessionId: string): void {
    const pending = this.pendingMessageUpdates.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMessageUpdates.delete(sessionId);
    const compacted = coalesceAssistantMessageUpdates(pending.updates);
    const stream = this.messageUpdateCompactors.get(sessionId);
    const updates =
      stream?.messageId === pending.messageId
        ? stream.compactor.addToolInputPreviews(compacted)
        : compacted;
    if (updates.length === 0) return;
    this.options.emit({
      type: "message-update",
      sessionId,
      messageId: pending.messageId,
      updates,
    });
  }

  private clearPendingMessageUpdates(sessionId: string): void {
    const pending = this.pendingMessageUpdates.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMessageUpdates.delete(sessionId);
  }
}
