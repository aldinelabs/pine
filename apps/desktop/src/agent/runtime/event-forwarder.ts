import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import {
  isSandboxDeniedPayload,
  type PineAgentEvent,
  type PineAssistantMessageUpdate,
  type PineJsonValue,
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
/**
 * Live tool output reaches the UI at most this often per tool call: the SDK's
 * own bash update throttle, so coalescing never slows the refresh users see.
 */
const TOOL_UPDATE_INTERVAL_MS = 100;
const STREAMED_MESSAGE_LIMIT = 1_000;

interface PendingMessageUpdates {
  messageId: string;
  timer: ReturnType<typeof setTimeout>;
  updates: PineAssistantMessageUpdate[];
}

interface ToolUpdateStream {
  toolName: string;
  /** When the last update for this call was emitted. */
  emittedAt: number;
  /** JSON of the last emitted payload, to skip identical snapshots. */
  emittedJson?: string;
  /** The newest snapshot not yet emitted (latest wins). */
  pending?: unknown;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * The SDK repeats a truncated output tail in `details.truncation.content`;
 * nothing downstream reads that copy, so a live update sends the tail once.
 */
function withoutRepeatedTail(partialResult: unknown): unknown {
  if (!isRecord(partialResult) || !isRecord(partialResult.details)) {
    return partialResult;
  }
  const truncation = partialResult.details.truncation;
  if (!isRecord(truncation) || !("content" in truncation)) return partialResult;
  const rest = { ...truncation };
  delete rest.content;
  return {
    ...partialResult,
    details: { ...partialResult.details, truncation: rest },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A message whose content already reached the renderer through `tool-end`. */
function isToolResultMessage(message: unknown): boolean {
  return isRecord(message) && message.role === "toolResult";
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
  /** Live tool output per session, keyed by tool call id. */
  private readonly toolUpdates = new Map<
    string,
    Map<string, ToolUpdateStream>
  >();
  /**
   * The message each streamed id stood for. A live transcript knows a
   * message by that id until it reloads with entry ids, so this lets the
   * runtime find the entry the renderer means.
   */
  private readonly streamedMessages = new Map<string, Map<string, unknown>>();

  constructor(private readonly options: PineAgentEventForwarderOptions) {}

  clearSession(sessionId: string): void {
    this.activeMessageIds.delete(sessionId);
    this.messageUpdateCompactors.delete(sessionId);
    this.clearPendingMessageUpdates(sessionId);
    this.clearToolUpdates(sessionId);
    this.activeCompactionIds.delete(sessionId);
    this.streamedMessages.delete(sessionId);
  }

  /** Sends everything still batched and stops every timer. */
  dispose(): void {
    for (const sessionId of [...this.pendingMessageUpdates.keys()])
      this.flushPendingMessageUpdates(sessionId);
    for (const sessionId of [...this.toolUpdates.keys()]) {
      this.flushToolUpdates(sessionId);
      this.clearToolUpdates(sessionId);
    }
  }

  /** The Pi message a streamed message id was sent for, if still known. */
  streamedMessage(sessionId: string, messageId: string): unknown {
    return this.streamedMessages.get(sessionId)?.get(messageId);
  }

  forward(session: AgentSession, event: AgentSessionEvent): void {
    const sessionId = session.sessionId;
    // Live tool output goes out before anything that follows it.
    if (event.type !== "tool_execution_update")
      this.flushToolUpdates(sessionId);
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
          let streamed = this.streamedMessages.get(sessionId);
          if (!streamed) {
            streamed = new Map();
            this.streamedMessages.set(sessionId, streamed);
          }
          streamed.set(messageId, event.message);
          // Older ids have long been replaced by entry ids on reload.
          if (streamed.size > STREAMED_MESSAGE_LIMIT)
            streamed.delete(streamed.keys().next().value as string);
          this.flushPendingMessageUpdates(sessionId);
          this.activeMessageIds.delete(sessionId);
          this.messageUpdateCompactors.delete(sessionId);
        }
        // A tool result already travelled in `tool-end`; the transcript
        // ignores its message events, so do not send the content again.
        if (!isToolResultMessage(event.message)) {
          this.options.emit({
            type:
              event.type === "message_start" ? "message-start" : "message-end",
            sessionId,
            messageId,
            message: toPineJsonValue(event.message),
          });
        }
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
        this.queueToolUpdate(
          sessionId,
          event.toolCallId,
          event.toolName,
          event.partialResult,
        );
        break;
      case "tool_execution_end": {
        this.toolUpdates.get(sessionId)?.delete(event.toolCallId);
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

  /**
   * The first snapshot of a tool call goes out at once, later ones at most
   * every TOOL_UPDATE_INTERVAL_MS with the newest snapshot winning.
   */
  private queueToolUpdate(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    partialResult: unknown,
  ): void {
    let streams = this.toolUpdates.get(sessionId);
    if (!streams) {
      streams = new Map();
      this.toolUpdates.set(sessionId, streams);
    }
    let stream = streams.get(toolCallId);
    if (!stream) {
      stream = { toolName, emittedAt: Number.NEGATIVE_INFINITY };
      streams.set(toolCallId, stream);
    }
    stream.toolName = toolName;
    stream.pending = partialResult;
    if (stream.timer) return;
    const wait = stream.emittedAt + TOOL_UPDATE_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.emitToolUpdate(sessionId, toolCallId, stream);
      return;
    }
    stream.timer = setTimeout(() => {
      const current = this.toolUpdates.get(sessionId)?.get(toolCallId);
      if (current) this.emitToolUpdate(sessionId, toolCallId, current);
    }, wait);
  }

  private emitToolUpdate(
    sessionId: string,
    toolCallId: string,
    stream: ToolUpdateStream,
  ): void {
    clearTimeout(stream.timer);
    stream.timer = undefined;
    if (!("pending" in stream)) return;
    const partialResult = stream.pending;
    delete stream.pending;
    const json = toToolUpdateJson(withoutRepeatedTail(partialResult));
    if (json !== undefined && json === stream.emittedJson) return;
    stream.emittedJson = json;
    stream.emittedAt = Date.now();
    this.options.emit({
      type: "tool-update",
      sessionId,
      toolCallId,
      toolName: stream.toolName,
      payload: parseToolUpdateJson(json, partialResult),
    });
  }

  private flushToolUpdates(sessionId: string): void {
    const streams = this.toolUpdates.get(sessionId);
    if (!streams) return;
    for (const [toolCallId, stream] of streams)
      if ("pending" in stream)
        this.emitToolUpdate(sessionId, toolCallId, stream);
  }

  private clearToolUpdates(sessionId: string): void {
    const streams = this.toolUpdates.get(sessionId);
    if (!streams) return;
    for (const stream of streams.values()) clearTimeout(stream.timer);
    this.toolUpdates.delete(sessionId);
  }

  private clearPendingMessageUpdates(sessionId: string): void {
    const pending = this.pendingMessageUpdates.get(sessionId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingMessageUpdates.delete(sessionId);
  }
}

/** The JSON of a tool update payload, or undefined when it has none. */
function toToolUpdateJson(value: unknown): string | undefined {
  if (value === undefined || typeof value === "string") return undefined;
  try {
    // `undefined` for values JSON cannot represent, such as a function.
    const json: string | undefined = JSON.stringify(value);
    return json;
  } catch {
    return undefined;
  }
}

/** Same result as `toPineJsonValue`, reusing the JSON already built. */
function parseToolUpdateJson(
  json: string | undefined,
  value: unknown,
): PineJsonValue {
  if (json === undefined) return toPineJsonValue(value);
  return JSON.parse(json) as PineJsonValue;
}
