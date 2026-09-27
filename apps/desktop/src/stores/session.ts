import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, reactive, ref, shallowRef, toRefs } from "vue";
import { toast } from "vue-sonner";
import {
  isSandboxDeniedPayload,
  type PineAgentEvent,
  type PineAssistantMessageUpdate,
  type PineApprovalAction,
  type PineApprovalMode,
  type PineApprovalTrigger,
  type PineAutoApprovalFailure,
  type PineJsonValue,
} from "@/shared/agent";
import type {
  PineContentBlock,
  PineCompactionStatus,
  PineContextUsage,
  PineSessionSummary,
  PineTextMessage,
  PineToolCall,
  SessionSearchResult,
} from "@/shared/sessions";
import { attachmentMessagePreview } from "@/shared/attachments";
import { parseMessageBlocks } from "@/shared/sessions";
import { isAppLocale } from "@/app/i18n";
import enUS from "@/app/i18n/locales/en-US";
import zhCN from "@/app/i18n/locales/zh-CN";
import { useModelsStore } from "@/stores/models";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";

function currentAppLocale(): "en-US" | "zh-CN" {
  const locale = document.documentElement.lang;
  return isAppLocale(locale) ? locale : "en-US";
}

export interface PineTranscriptMessage extends PineTextMessage {
  status: "complete" | "streaming";
  thinkingStatus?: "complete" | "streaming";
  thinkingStartedAt?: number;
}

/** A tool call awaiting the user's approve/reject/guide decision. */
export interface PinePendingApproval {
  requestId: string;
  toolCallId: string;
  toolName: string;
  trigger: PineApprovalTrigger;
  subject?: string;
  /** The tool call's imperative summary, shown above the raw arguments. */
  description?: string;
  evidence?: string;
  autoApprovalFailure?: PineAutoApprovalFailure;
}

export interface PinePendingQuestionnaire {
  requestId: string;
  toolCallId: string;
  questionnaire: AskUserQuestionParams;
}

function messageRole(value: PineJsonValue): "assistant" | "user" | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value.role === "assistant" || value.role === "user"
    ? value.role
    : null;
}

function blocksHasThinking(blocks: readonly PineContentBlock[]): boolean {
  return blocks.some((block) => block.type === "thinking");
}

function toTranscriptMessages(
  source: readonly PineTextMessage[],
): PineTranscriptMessage[] {
  return source.map((message) => ({
    ...message,
    status: "complete" as const,
    ...(blocksHasThinking(message.blocks)
      ? { thinkingStatus: "complete" as const }
      : {}),
  }));
}

function mergeToolCallBlocks(
  blocks: PineContentBlock[],
  toolCallId: string,
  patch: Partial<PineToolCall>,
): PineContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "toolCall" || block.toolCall.id !== toolCallId) {
      return block;
    }
    return { ...block, toolCall: { ...block.toolCall, ...patch } };
  });
}

function mergeBlockStatuses(
  blocks: PineContentBlock[],
  previous: readonly PineContentBlock[] | undefined,
): PineContentBlock[] {
  if (!previous || previous.length === 0) return blocks;
  const previousToolCalls = new Map(
    previous.flatMap((block) =>
      block.type === "toolCall" ? [[block.toolCall.id, block.toolCall]] : [],
    ),
  );
  return blocks.map((block) => {
    if (block.type !== "toolCall") return block;
    const prior = previousToolCalls.get(block.toolCall.id);
    if (!prior) return block;
    // Execution runtime fields (status/startedAt/durationMs/output) come from
    // the prior snapshot, but streaming input grows on every update — a stale
    // snapshot (e.g. an empty arguments object from toolcall_start) must not
    // shadow the freshly parsed progressive arguments.
    const toolCall = {
      ...prior,
      id: block.toolCall.id,
      name: block.toolCall.name,
    };
    if (block.toolCall.input !== undefined) {
      toolCall.input = block.toolCall.input;
    }
    return { ...block, toolCall };
  });
}

function messageCreatedAt(value: PineJsonValue): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new Date().toISOString();
  }
  return typeof value.timestamp === "number"
    ? new Date(value.timestamp).toISOString()
    : new Date().toISOString();
}

function applyAssistantMessageUpdates(
  previous: readonly PineContentBlock[],
  updates: readonly PineAssistantMessageUpdate[],
): PineContentBlock[] {
  const blocks = [...previous];
  for (const update of updates) {
    const current = blocks[update.contentIndex];
    switch (update.type) {
      case "text-start":
        blocks[update.contentIndex] = { type: "text", text: update.text };
        break;
      case "text-delta":
        blocks[update.contentIndex] = {
          type: "text",
          text:
            current?.type === "text"
              ? current.text + update.delta
              : update.delta,
        };
        break;
      case "text-end":
        blocks[update.contentIndex] = { type: "text", text: update.text };
        break;
      case "thinking-start":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking: update.thinking,
        };
        break;
      case "thinking-delta":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking:
            current?.type === "thinking"
              ? current.thinking + update.delta
              : update.delta,
        };
        break;
      case "thinking-end":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking: update.thinking,
        };
        break;
      case "tool-call-start":
        blocks[update.contentIndex] = {
          type: "toolCall",
          toolCall: {
            id: update.id,
            name: update.name,
            status: "pending",
            ...(update.input === undefined ? {} : { input: update.input }),
          },
        };
        break;
      case "tool-call-delta":
        if (current?.type === "toolCall" && update.input !== undefined) {
          blocks[update.contentIndex] = {
            ...current,
            toolCall: { ...current.toolCall, input: update.input },
          };
        }
        break;
      case "tool-call-end":
        blocks[update.contentIndex] = {
          type: "toolCall",
          toolCall: {
            ...(current?.type === "toolCall" ? current.toolCall : {}),
            id: update.id,
            name: update.name,
            status:
              current?.type === "toolCall"
                ? current.toolCall.status
                : "pending",
            ...(update.input === undefined ? {} : { input: update.input }),
          },
        };
        break;
    }
  }
  return blocks;
}

function compactionMessage(
  compactionId: string,
  status: PineCompactionStatus,
): PineTranscriptMessage {
  return {
    createdAt: new Date().toISOString(),
    id: `compaction-${compactionId}`,
    role: "assistant",
    status: status === "running" ? "streaming" : "complete",
    blocks: [
      {
        type: "compaction",
        compaction: { id: compactionId, status },
      },
    ],
  };
}

function createSessionState() {
  const activeSession = shallowRef<PineSessionSummary | null>(null);
  const messages = ref<PineTranscriptMessage[]>([]);
  const outlineMessages = ref<PineTranscriptMessage[]>([]);
  const isLoadingMessages = ref(false);
  const isRunning = ref(false);
  const contextUsage = ref<PineContextUsage | null>(null);
  const pendingApprovals = ref<PinePendingApproval[]>([]);
  const pendingQuestionnaires = ref<PinePendingQuestionnaire[]>([]);
  const steeringMessages = ref<string[]>([]);
  const respondingRequestIds = ref<ReadonlySet<string>>(new Set());
  /** Tool calls currently held by the auto-reviewer (auto-approve). */
  const reviewingToolCallIds = ref<ReadonlySet<string>>(new Set());
  const hasEarlierMessages = ref(false);
  const nextBefore = ref<string | undefined>();
  const messageIndexes = new Map<string, number>();
  const toolCallMessageIndexes = new Map<string, number>();
  const activeMcpToolCalls = new Map<string, string>();
  const mcpApprovalToolCalls = new Map<string, string>();

  function messageIndexFor(messageId: string): number {
    const cached = messageIndexes.get(messageId);
    if (cached !== undefined && messages.value[cached]?.id === messageId) {
      return cached;
    }
    const index = messages.value.findIndex(
      (message) => message.id === messageId,
    );
    if (index >= 0) messageIndexes.set(messageId, index);
    else messageIndexes.delete(messageId);
    return index;
  }

  function toolCallMessageIndexFor(toolCallId: string): number {
    const cached = toolCallMessageIndexes.get(toolCallId);
    if (
      cached !== undefined &&
      messages.value[cached]?.blocks.some(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === toolCallId,
      )
    ) {
      return cached;
    }
    const index = messages.value.findIndex((message) =>
      message.blocks.some(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === toolCallId,
      ),
    );
    if (index >= 0) toolCallMessageIndexes.set(toolCallId, index);
    else toolCallMessageIndexes.delete(toolCallId);
    return index;
  }

  function rememberMessageIndex(
    message: PineTranscriptMessage,
    index: number,
  ): void {
    messageIndexes.set(message.id, index);
    for (const block of message.blocks) {
      if (block.type === "toolCall") {
        toolCallMessageIndexes.set(block.toolCall.id, index);
      }
    }
  }

  function clearMessageIndexes(): void {
    messageIndexes.clear();
    toolCallMessageIndexes.clear();
  }

  function approvalToolCallId(toolCallId: string, toolName: string): string {
    const linked = mcpApprovalToolCalls.get(toolCallId);
    if (linked) return linked;
    if (toolCallMessageIndexFor(toolCallId) >= 0) return toolCallId;

    const candidates = [...activeMcpToolCalls].filter(
      ([, activeName]) =>
        activeName === toolName ||
        activeName === "mcp" ||
        activeName === "mcpScript" ||
        activeName.startsWith("mcp__"),
    );
    if (candidates.length !== 1) return toolCallId;

    const parentId = candidates[0][0];
    mcpApprovalToolCalls.set(toolCallId, parentId);
    return parentId;
  }

  function resetMcpApprovalLinks(): void {
    activeMcpToolCalls.clear();
    mcpApprovalToolCalls.clear();
  }

  function patchToolCall(
    toolCallId: string,
    patch: Partial<PineToolCall>,
  ): void {
    const index = toolCallMessageIndexFor(toolCallId);
    if (index < 0) return;
    const message = messages.value[index];
    messages.value[index] = {
      ...message,
      blocks: mergeToolCallBlocks(message.blocks, toolCallId, patch),
    };
  }
  return reactive({
    summary: activeSession,
    messages,
    outlineMessages,
    isLoadingMessages,
    isRunning,
    contextUsage,
    pendingApprovals,
    pendingQuestionnaires,
    steeringMessages,
    reviewingToolCallIds,
    respondingRequestIds,
    hasEarlierMessages,
    nextBefore,
    messageIndexFor,
    toolCallMessageIndexFor,
    approvalToolCallId,
    activeMcpToolCalls,
    mcpApprovalToolCalls,
    resetMcpApprovalLinks,
    rememberMessageIndex,
    clearMessageIndexes,
    patchToolCall,
    notifiedAutoApprovalFailureIds: new Set<string>(),
    historyLoaded: false,
    historyLoad: null as Promise<void> | null,
  });
}

type SessionState = ReturnType<typeof createSessionState>;

export const useSessionStore = defineStore("session", () => {
  const modelsStore = useModelsStore();
  const recentSessions = shallowRef<SessionSearchResult[]>([]);
  const searchResults = shallowRef<SessionSearchResult[]>([]);
  const isLoadingRecent = ref(false);
  const isSearching = ref(false);
  const currentSessionId = ref<string | null>(null);
  const draftState = ref(createSessionState());
  const sessionCache = reactive(new Map<string, SessionState>());

  function stateFor(sessionId: string): SessionState {
    let state = sessionCache.get(sessionId);
    if (!state) {
      state = createSessionState();
      sessionCache.set(sessionId, state);
    }
    return state;
  }

  const activeState = computed(() =>
    currentSessionId.value
      ? stateFor(currentSessionId.value)
      : draftState.value,
  );
  function projection<K extends keyof SessionState>(key: K) {
    return computed({
      get: () => activeState.value[key],
      set: (value: SessionState[K]) => {
        activeState.value[key] = value;
      },
    });
  }
  const activeSession = projection("summary");
  const messages = projection("messages");
  const outlineMessages = projection("outlineMessages");
  const isLoadingMessages = projection("isLoadingMessages");
  const isRunning = projection("isRunning");
  const contextUsage = projection("contextUsage");
  const pendingApprovals = projection("pendingApprovals");
  const pendingQuestionnaires = projection("pendingQuestionnaires");
  const steeringMessages = projection("steeringMessages");
  const reviewingToolCallIds = projection("reviewingToolCallIds");
  const hasEarlierMessages = projection("hasEarlierMessages");
  function dropSessionCache(sessionId: string): void {
    // Closing a view must not discard a running session or its interaction queue.
    const state = sessionCache.get(sessionId);
    if (
      state &&
      !state.isRunning &&
      !state.pendingApprovals.length &&
      !state.pendingQuestionnaires.length
    )
      sessionCache.delete(sessionId);
  }
  let stopAgentEvents: (() => void) | null = null;
  let searchSequence = 0;
  let recentSequence = 0;
  let activationSequence = 0;
  let projectEpoch = 0;

  function mergeSessionSummary(
    session: PineSessionSummary,
    previous?: PineSessionSummary,
  ): PineSessionSummary {
    return {
      ...previous,
      ...session,
      ...(session.name || previous?.name
        ? { name: session.name || previous?.name }
        : {}),
      ...(session.preview || previous?.preview
        ? { preview: session.preview || previous?.preview }
        : {}),
    };
  }

  function upsertRecentSession(
    session: PineSessionSummary,
  ): SessionSearchResult {
    recentSequence += 1;
    isLoadingRecent.value = false;
    const previous = recentSessions.value.find(
      (candidate) => candidate.id === session.id,
    );
    const nextSession = mergeSessionSummary(session, previous);
    recentSessions.value = [
      nextSession,
      ...recentSessions.value.filter(
        (candidate) => candidate.id !== session.id,
      ),
    ].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
    return nextSession;
  }

  async function loadRecent(): Promise<SessionSearchResult[]> {
    const sequence = ++recentSequence;
    isLoadingRecent.value = true;

    try {
      const result = await window.pine.searchSessions({ query: "" });
      if (sequence === recentSequence) recentSessions.value = result.sessions;
      return result.sessions;
    } finally {
      if (sequence === recentSequence) isLoadingRecent.value = false;
    }
  }

  async function search(query: string): Promise<SessionSearchResult[]> {
    const sequence = ++searchSequence;
    isSearching.value = true;

    try {
      const sessions = query.trim()
        ? (await window.pine.searchSessions({ query })).sessions
        : await loadRecent();
      if (sequence === searchSequence) searchResults.value = sessions;
      return sessions;
    } finally {
      if (sequence === searchSequence) isSearching.value = false;
    }
  }

  async function resume(sessionId: string): Promise<PineSessionSummary> {
    const sequence = ++activationSequence;
    const epoch = projectEpoch;
    const state = stateFor(sessionId);
    currentSessionId.value = sessionId;
    if (state.summary && state.historyLoaded) return state.summary;
    state.isLoadingMessages = true;
    try {
      const result = await window.pine.resumeSession({ sessionId });
      if (epoch !== projectEpoch) return result.session;
      const summary = upsertRecentSession(result.session);
      state.summary = mergeSessionSummary(summary, state.summary ?? undefined);
      modelsStore.setSessionSelection(sessionId, summary.modelSelection);
      state.contextUsage = state.contextUsage ?? result.contextUsage ?? null;
      await loadInitialMessages(sessionId);
      return state.summary;
    } catch (error) {
      if (sequence === activationSequence) currentSessionId.value = null;
      throw error;
    } finally {
      state.isLoadingMessages = false;
    }
  }

  function mergeHistory(
    source: readonly PineTextMessage[],
    live: PineTranscriptMessage[],
  ): PineTranscriptMessage[] {
    const byId = new Map(
      toTranscriptMessages(source).map((message) => [message.id, message]),
    );
    for (const message of live) byId.set(message.id, message);
    return [...byId.values()];
  }

  async function loadInitialMessages(sessionId: string): Promise<void> {
    const state = stateFor(sessionId);
    if (state.historyLoaded) return;
    if (state.historyLoad) return state.historyLoad;
    state.isLoadingMessages = true;
    const request = (async () => {
      const result = await window.pine.loadSessionMessages({
        includeOutline: true,
        sessionId,
        limit: 50,
      });
      state.messages = mergeHistory(result.messages, state.messages);
      state.outlineMessages = mergeHistory(
        result.outline ?? result.messages,
        state.outlineMessages,
      );
      state.clearMessageIndexes();
      state.hasEarlierMessages = result.hasMore;
      state.nextBefore = result.nextBefore;
      state.historyLoaded = true;
    })();
    state.historyLoad = request;
    try {
      await request;
    } finally {
      state.historyLoad = null;
      state.isLoadingMessages = false;
    }
  }

  function loadEarlierMessages(
    sessionId = currentSessionId.value,
  ): Promise<void> {
    if (!sessionId) return Promise.resolve();
    const state = stateFor(sessionId);
    if (state.historyLoad) return state.historyLoad;
    if (!state.hasEarlierMessages || !state.nextBefore)
      return Promise.resolve();
    const before = state.nextBefore;
    state.isLoadingMessages = true;
    const request = (async () => {
      const result = await window.pine.loadSessionMessages({
        before,
        sessionId,
        limit: 50,
      });
      state.messages = mergeHistory(result.messages, state.messages);
      state.outlineMessages = mergeHistory(
        result.messages,
        state.outlineMessages,
      );
      state.clearMessageIndexes();
      state.hasEarlierMessages = result.hasMore;
      state.nextBefore = result.nextBefore;
    })();
    state.historyLoad = request;
    return request.finally(() => {
      state.historyLoad = null;
      state.isLoadingMessages = false;
    });
  }

  async function prompt(
    message: string,
    sessionId?: string,
    approvalMode?: PineApprovalMode,
    streamingBehavior?: "follow-up" | "steer",
  ): Promise<PineSessionSummary> {
    const sequence = activationSequence;
    const epoch = projectEpoch;
    const target = sessionId ? stateFor(sessionId) : draftState.value;
    target.isRunning = true;
    try {
      const result = await window.pine.promptSession({
        locale: currentAppLocale(),
        message,
        target: sessionId ? { kind: "session", sessionId } : { kind: "new" },
        ...(approvalMode ? { approvalMode } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
      if (epoch !== projectEpoch) return result.session;
      const summary = upsertRecentSession({
        ...result.session,
        preview: result.session.preview || attachmentMessagePreview(message),
      });
      const state = stateFor(summary.id);
      state.summary = mergeSessionSummary(summary, state.summary ?? undefined);
      // Worker events may already have arrived, including the terminal state.
      if (!sessionId && !state.historyLoaded)
        state.historyLoaded = state.messages.length > 0;
      modelsStore.setSessionSelection(summary.id, summary.modelSelection);
      if (sequence === activationSequence) currentSessionId.value = summary.id;
      return summary;
    } catch (error) {
      if (!streamingBehavior) target.isRunning = false;
      throw error;
    }
  }

  async function steer(
    message: string,
    approvalMode?: PineApprovalMode,
    sessionId = currentSessionId.value,
  ): Promise<void> {
    if (!sessionId)
      throw new Error("The running session is not ready for steering yet.");
    await window.pine.promptSession({
      locale: currentAppLocale(),
      message,
      target: { kind: "session", sessionId },
      approvalMode,
      streamingBehavior: "steer",
    });
  }

  async function abort(sessionId = currentSessionId.value): Promise<void> {
    if (sessionId) await window.pine.abortSession({ sessionId });
  }

  async function compactContext(
    sessionId = currentSessionId.value,
  ): Promise<boolean> {
    if (!sessionId) return false;
    return (await window.pine.compactSession({ sessionId })).compacted;
  }

  async function dequeueSteering(
    message: string,
    sessionId = currentSessionId.value,
  ): Promise<string | undefined> {
    if (!sessionId) return;
    const result = await window.pine.dequeueSteering({ message, sessionId });
    return result.removed ? result.message : undefined;
  }

  async function setApprovalMode(
    approvalMode: PineApprovalMode,
    sessionId = currentSessionId.value,
  ): Promise<void> {
    if (sessionId)
      await window.pine.setApprovalMode({ approvalMode, sessionId });
  }

  async function respondApproval(
    action: PineApprovalAction,
    guidance?: string,
    requestId?: string,
    sessionId = currentSessionId.value,
  ): Promise<void> {
    if (!sessionId) return;
    const state = stateFor(sessionId);
    const pending = requestId
      ? state.pendingApprovals.find((item) => item.requestId === requestId)
      : state.pendingApprovals[0];
    if (!pending) return;
    if (state.respondingRequestIds.has(pending.requestId)) return;
    state.respondingRequestIds = new Set([
      ...state.respondingRequestIds,
      pending.requestId,
    ]);
    try {
      await window.pine.respondApproval({
        requestId: pending.requestId,
        action,
        guidance,
      });
      state.pendingApprovals = state.pendingApprovals.filter(
        (item) => item.requestId !== pending.requestId,
      );
    } finally {
      state.respondingRequestIds = new Set(
        [...state.respondingRequestIds].filter(
          (id) => id !== pending.requestId,
        ),
      );
    }
  }

  async function respondQuestionnaire(
    submission: AskUserQuestionSubmission,
    requestId?: string,
    sessionId = currentSessionId.value,
  ): Promise<void> {
    if (!sessionId) return;
    const state = stateFor(sessionId);
    const pending = requestId
      ? state.pendingQuestionnaires.find((item) => item.requestId === requestId)
      : state.pendingQuestionnaires[0];
    if (!pending || state.respondingRequestIds.has(pending.requestId)) return;
    state.respondingRequestIds = new Set([
      ...state.respondingRequestIds,
      pending.requestId,
    ]);
    try {
      await window.pine.respondQuestionnaire({
        requestId: pending.requestId,
        submission,
      });
      state.pendingQuestionnaires = state.pendingQuestionnaires.filter(
        (item) => item.requestId !== pending.requestId,
      );
    } finally {
      state.respondingRequestIds = new Set(
        [...state.respondingRequestIds].filter(
          (id) => id !== pending.requestId,
        ),
      );
    }
  }

  async function deleteSession(sessionId: string): Promise<boolean> {
    const { deleted } = await window.pine.deleteSession({ sessionId });
    if (!deleted) return false;

    recentSequence += 1;
    isLoadingRecent.value = false;
    recentSessions.value = recentSessions.value.filter(
      (session) => session.id !== sessionId,
    );
    searchResults.value = searchResults.value.filter(
      (session) => session.id !== sessionId,
    );
    sessionCache.delete(sessionId);
    modelsStore.setSessionSelection(sessionId, undefined);
    if (currentSessionId.value === sessionId) startDraft();
    return true;
  }

  async function renameSession(
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const result = await window.pine.renameSession({ sessionId, name });
    const previous =
      recentSessions.value.find((session) => session.id === sessionId) ??
      searchResults.value.find((session) => session.id === sessionId) ??
      (activeSession.value?.id === sessionId
        ? activeSession.value
        : undefined) ??
      sessionCache.get(sessionId)?.summary ??
      undefined;
    const session = mergeSessionSummary(result.session, previous ?? undefined);

    recentSequence += 1;
    searchSequence += 1;
    recentSessions.value = recentSessions.value
      .map((candidate) => (candidate.id === sessionId ? session : candidate))
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      );
    searchResults.value = searchResults.value.map((candidate) =>
      candidate.id === sessionId ? { ...candidate, ...session } : candidate,
    );
    if (activeSession.value?.id === sessionId) activeSession.value = session;

    const cached = sessionCache.get(sessionId);
    if (cached) cached.summary = session;
    return session;
  }

  function handleAgentEvent(event: PineAgentEvent): void {
    const state = stateFor(event.sessionId);
    const {
      summary: activeSession,
      messages,
      isRunning,
      contextUsage,
      pendingApprovals,
      pendingQuestionnaires,
      steeringMessages,
      reviewingToolCallIds,
    } = toRefs(state);
    const {
      messageIndexFor,
      toolCallMessageIndexFor,
      approvalToolCallId,
      rememberMessageIndex,
      patchToolCall,
    } = state;
    if (event.type === "run-state") {
      isRunning.value = event.state === "running" || event.state === "aborting";
      if (event.state === "idle" || event.state === "failed") {
        pendingApprovals.value = [];
        state.notifiedAutoApprovalFailureIds.clear();
        pendingQuestionnaires.value = [];
        reviewingToolCallIds.value = new Set();
        state.resetMcpApprovalLinks();
        steeringMessages.value = [];
      }
      return;
    }
    if (event.type === "steering-queue") {
      steeringMessages.value = [...event.messages];
      return;
    }
    if (event.type === "session-error") {
      messages.value.push({
        createdAt: new Date().toISOString(),
        id: `error-${event.errorId}`,
        role: "assistant",
        status: "complete",
        blocks: [{ type: "error", error: { message: event.message } }],
      });
      return;
    }
    if (event.type === "tool-review") {
      const toolCallId = approvalToolCallId(event.toolCallId, event.toolName);
      reviewingToolCallIds.value = new Set([
        ...reviewingToolCallIds.value,
        toolCallId,
      ]);
      patchToolCall(toolCallId, {
        approval: { state: "reviewing" },
      });
      return;
    }
    if (event.type === "approval-request") {
      const toolCallId = approvalToolCallId(event.toolCallId, event.toolName);
      const input = event.input as
        { subject?: unknown; description?: unknown } | undefined;
      pendingApprovals.value = [
        ...pendingApprovals.value,
        {
          requestId: event.requestId,
          toolCallId,
          toolName: event.toolName,
          trigger: event.trigger,
          subject:
            typeof input?.subject === "string" ? input.subject : undefined,
          description:
            typeof input?.description === "string"
              ? input.description
              : undefined,
          evidence: event.evidence,
          autoApprovalFailure: event.autoApprovalFailure,
        },
      ];
      const failure = event.autoApprovalFailure;
      if (failure && !state.notifiedAutoApprovalFailureIds.has(failure.id)) {
        state.notifiedAutoApprovalFailureIds.add(failure.id);
        const messages = currentAppLocale() === "zh-CN" ? zhCN : enUS;
        toast.error(messages.project.approvalRequest.autoApprovalFailed, {
          id: `auto-approval-failed-${failure.id}`,
          description: failure.message,
        });
      }
      patchToolCall(toolCallId, {
        approval: { state: "awaiting-user" },
      });
      return;
    }
    if (event.type === "approval-decided") {
      const toolCallId =
        state.mcpApprovalToolCalls.get(event.toolCallId) ?? event.toolCallId;
      state.mcpApprovalToolCalls.delete(event.toolCallId);
      pendingApprovals.value = pendingApprovals.value.filter(
        (approval) => approval.requestId !== event.requestId,
      );
      const remaining = new Set(reviewingToolCallIds.value);
      if (![...state.mcpApprovalToolCalls.values()].includes(toolCallId)) {
        remaining.delete(toolCallId);
      }
      reviewingToolCallIds.value = remaining;
      if (remaining.has(toolCallId)) return;
      patchToolCall(toolCallId, {
        approval: {
          state: event.verdict === "approved" ? "approved" : "denied",
          decidedBy: event.decidedBy,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      });
      return;
    }
    if (event.type === "questionnaire-request") {
      pendingQuestionnaires.value = [
        ...pendingQuestionnaires.value,
        {
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          questionnaire: event.questionnaire,
        },
      ];
      return;
    }
    if (event.type === "questionnaire-decided") {
      pendingQuestionnaires.value = pendingQuestionnaires.value.filter(
        (questionnaire) => questionnaire.requestId !== event.requestId,
      );
      return;
    }
    if (event.type === "session-updated") {
      const previous =
        activeSession.value?.id === event.sessionId
          ? activeSession.value
          : recentSessions.value.find(
              (session) => session.id === event.sessionId,
            );
      const summary = mergeSessionSummary(event.summary, previous);
      modelsStore.setSessionSelection(event.sessionId, summary.modelSelection);
      activeSession.value = summary;
      upsertRecentSession(summary);
      return;
    }
    if (event.type === "context-usage") {
      const usage: PineContextUsage = {
        tokens: event.tokens,
        contextWindow: event.contextWindow,
        percent: event.percent,
        cost: event.cost,
        cacheHitRate: event.cacheHitRate,
      };
      contextUsage.value = usage;
      const cached = sessionCache.get(event.sessionId);
      if (cached) cached.contextUsage = usage;
      return;
    }
    if (event.type === "compaction-start" || event.type === "compaction-end") {
      const status: PineCompactionStatus =
        event.type === "compaction-start" ? "running" : event.status;
      const messageIndex = messageIndexFor(`compaction-${event.compactionId}`);
      const previous =
        messageIndex >= 0 ? messages.value[messageIndex] : undefined;
      const nextMessage = previous
        ? {
            ...previous,
            status:
              status === "running"
                ? ("streaming" as const)
                : ("complete" as const),
            blocks: [
              {
                type: "compaction" as const,
                compaction: { id: event.compactionId, status },
              },
            ],
          }
        : compactionMessage(event.compactionId, status);
      if (messageIndex < 0) {
        messages.value.push(nextMessage);
        rememberMessageIndex(nextMessage, messages.value.length - 1);
      } else {
        messages.value[messageIndex] = nextMessage;
        rememberMessageIndex(nextMessage, messageIndex);
      }
      return;
    }
    if (
      event.type === "tool-start" ||
      event.type === "tool-update" ||
      event.type === "tool-end"
    ) {
      if (event.type === "tool-start") {
        state.activeMcpToolCalls.set(event.toolCallId, event.toolName);
      }
      const now = Date.now();
      let messageIndex = toolCallMessageIndexFor(event.toolCallId);
      if (messageIndex < 0) {
        messages.value.push({
          createdAt: new Date(now).toISOString(),
          id: `tool-${event.toolCallId}`,
          role: "assistant",
          status: "complete",
          blocks: [
            {
              type: "toolCall",
              toolCall: {
                id: event.toolCallId,
                name: event.toolName,
                status: "pending",
              },
            },
          ],
        });
        messageIndex = messages.value.length - 1;
        rememberMessageIndex(messages.value[messageIndex], messageIndex);
      }

      const message = messages.value[messageIndex];
      const existing = message.blocks.find(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === event.toolCallId,
      );
      const existingToolCall =
        existing?.type === "toolCall" ? existing.toolCall : undefined;
      const startedAt =
        existingToolCall?.startedAt ??
        (event.type === "tool-start" ? new Date(now).toISOString() : undefined);
      const patch: Partial<PineToolCall> = {
        name: event.toolName,
        status:
          event.type === "tool-end"
            ? event.isError
              ? ("error" as const)
              : ("complete" as const)
            : ("running" as const),
        // A deterministic sandbox rejection of an ordinary bash call is a
        // denial (warning), not a runtime execution failure (destructive).
        ...(event.type === "tool-end" &&
        event.isError &&
        isSandboxDeniedPayload(event.payload)
          ? {
              approval: {
                state: "denied" as const,
                decidedBy: "sandbox" as const,
              },
            }
          : {}),
        ...(event.type === "tool-start" && event.payload !== undefined
          ? { input: event.payload }
          : {}),
        ...(event.type !== "tool-start" && event.payload !== undefined
          ? { output: event.payload }
          : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(event.type === "tool-end" && startedAt
          ? {
              durationMs: Math.max(0, now - new Date(startedAt).getTime()),
            }
          : {}),
      };
      messages.value[messageIndex] = {
        ...message,
        blocks: mergeToolCallBlocks(message.blocks, event.toolCallId, patch),
      };
      rememberMessageIndex(messages.value[messageIndex], messageIndex);
      if (event.type === "tool-end") {
        state.activeMcpToolCalls.delete(event.toolCallId);
      }
      return;
    }
    if (
      (event.type !== "message-start" &&
        event.type !== "message-update" &&
        event.type !== "message-end") ||
      false
    ) {
      return;
    }

    const previousIndex = messageIndexFor(event.messageId);
    const previous =
      previousIndex >= 0 ? messages.value[previousIndex] : undefined;
    const now = Date.now();
    if (event.type === "message-update") {
      const blocks = applyAssistantMessageUpdates(
        previous?.blocks ?? [],
        event.updates,
      );
      const hasThinking = blocksHasThinking(blocks);
      const thinkingStarted = event.updates.some(
        (update) =>
          update.type === "thinking-start" || update.type === "thinking-delta",
      );
      const thinkingEnded = event.updates.some(
        (update) => update.type === "thinking-end",
      );
      const thinkingStartedAt = hasThinking
        ? (previous?.thinkingStartedAt ?? (thinkingStarted ? now : undefined))
        : undefined;
      const thinkingStatus = hasThinking
        ? thinkingEnded || previous?.thinkingStatus === "complete"
          ? ("complete" as const)
          : ("streaming" as const)
        : undefined;
      const thinkingDurationMs =
        thinkingStartedAt && thinkingStatus === "complete"
          ? (previous?.thinkingDurationMs ??
            Math.max(0, now - thinkingStartedAt))
          : undefined;
      const nextMessage: PineTranscriptMessage = {
        createdAt: previous?.createdAt ?? new Date(now).toISOString(),
        id: event.messageId,
        role: "assistant",
        status: "streaming",
        blocks,
        ...(thinkingDurationMs ? { thinkingDurationMs } : {}),
        ...(thinkingStatus ? { thinkingStatus } : {}),
        ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
      };
      if (previousIndex < 0) {
        messages.value.push(nextMessage);
        rememberMessageIndex(nextMessage, messages.value.length - 1);
      } else {
        messages.value[previousIndex] = nextMessage;
        rememberMessageIndex(nextMessage, previousIndex);
      }
      return;
    }

    const role = messageRole(event.message);
    if (!role) return;
    const blocks = mergeBlockStatuses(
      parseMessageBlocks(event.message),
      previous?.blocks,
    );
    const hasThinking = blocksHasThinking(blocks);
    const thinkingStartedAt = hasThinking
      ? (previous?.thinkingStartedAt ?? now)
      : undefined;
    const thinkingEnded = event.type === "message-end";
    const thinkingStatus = hasThinking
      ? thinkingEnded || previous?.thinkingStatus === "complete"
        ? ("complete" as const)
        : ("streaming" as const)
      : undefined;
    const thinkingDurationMs =
      thinkingStartedAt && thinkingStatus === "complete"
        ? (previous?.thinkingDurationMs ?? Math.max(0, now - thinkingStartedAt))
        : undefined;
    const nextMessage: PineTranscriptMessage = {
      createdAt: messageCreatedAt(event.message),
      id: event.messageId,
      role,
      status: event.type === "message-end" ? "complete" : "streaming",
      blocks,
      ...(thinkingDurationMs ? { thinkingDurationMs } : {}),
      ...(thinkingStatus ? { thinkingStatus } : {}),
      ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
    };

    if (previousIndex < 0) {
      messages.value.push(nextMessage);
      rememberMessageIndex(nextMessage, messages.value.length - 1);
    } else {
      messages.value[previousIndex] = nextMessage;
      rememberMessageIndex(nextMessage, previousIndex);
    }
  }

  function connectAgentEvents(): void {
    if (stopAgentEvents || !window.pine.onSessionEvent) return;
    stopAgentEvents = window.pine.onSessionEvent(handleAgentEvent);
  }

  function startDraft(): void {
    activationSequence += 1;
    currentSessionId.value = null;
    draftState.value = createSessionState();
  }

  function reset(): void {
    projectEpoch += 1;
    activationSequence += 1;
    searchSequence += 1;
    recentSequence += 1;
    currentSessionId.value = null;
    sessionCache.clear();
    draftState.value = createSessionState();
    recentSessions.value = [];
    searchResults.value = [];
    modelsStore.clearSessionSelections();
    isLoadingRecent.value = false;
    isSearching.value = false;
  }

  return {
    activeSession,
    stateFor,
    abort,
    connectAgentEvents,
    compactContext,
    contextUsage,
    deleteSession,
    dequeueSteering,
    dropSessionCache,
    hasEarlierMessages,
    isLoadingRecent,
    isLoadingMessages,
    isRunning,
    isSearching,
    loadRecent,
    loadEarlierMessages,
    messages,
    outlineMessages,
    pendingApprovals,
    pendingQuestionnaires,
    prompt,
    recentSessions,
    renameSession,
    reset,
    respondApproval,
    respondQuestionnaire,
    resume,
    reviewingToolCallIds,
    search,
    searchResults,
    setApprovalMode,
    startDraft,
    steer,
    steeringMessages,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionStore, import.meta.hot));
}
