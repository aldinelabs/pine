import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "vue-sonner";
import type { PineAgentEvent } from "@/shared/agent";
import type { PineSessionSummary, PineTextMessage } from "@/shared/sessions";
import { useSessionStore } from "../session";

vi.mock("vue-sonner", () => ({ toast: { error: vi.fn() } }));

const a: PineSessionSummary = {
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  createdAt: "2026-09-29T00:00:00Z",
  updatedAt: "2026-09-29T00:00:00Z",
  messageCount: 0,
};
const b = { ...a, id: "019cfe51-7166-79b9-a5b9-c652fcca9eac" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let emit!: (event: PineAgentEvent) => void;
  const api = {
    onSessionEvent: vi.fn((listener) => {
      emit = listener;
      return () => {};
    }),
    resumeSession: vi.fn(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({ session: sessionId === a.id ? a : b }),
    ),
    loadSessionMessages: vi
      .fn()
      .mockResolvedValue({ messages: [], hasMore: false }),
    promptSession: vi.fn().mockResolvedValue({ accepted: true, session: a }),
    respondApproval: vi.fn().mockResolvedValue({ accepted: true }),
    respondQuestionnaire: vi.fn().mockResolvedValue({ accepted: true }),
    abortSession: vi.fn().mockResolvedValue({ aborted: true }),
    compactSession: vi.fn().mockResolvedValue({ compacted: true }),
    dequeueSteering: vi.fn().mockResolvedValue({ removed: false }),
    setApprovalMode: vi.fn().mockResolvedValue({ updated: true }),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  const store = useSessionStore();
  store.connectAgentEvents();
  return { store, api, emit: (event: PineAgentEvent) => emit(event) };
}

function approval(sessionId: string, requestId: string): PineAgentEvent {
  return {
    type: "approval-request",
    sessionId,
    requestId,
    toolCallId: requestId,
    toolName: "bash",
    trigger: "pre-execution",
  };
}

describe("concurrent session state", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.lang = "en-US";
  });

  it("keeps background approvals, questions, streaming and run state in their owning session", async () => {
    const { store, emit, api } = fixture();
    await store.resume(a.id);
    emit({ type: "run-state", sessionId: a.id, state: "running" });
    await store.resume(b.id);
    emit({ type: "run-state", sessionId: b.id, state: "running" });
    emit(approval(a.id, "a-1"));
    emit(approval(b.id, "b-1"));
    emit({
      type: "questionnaire-request",
      sessionId: a.id,
      requestId: "question-a",
      toolCallId: "ask-a",
      questionnaire: { questions: [] },
    });
    emit({
      type: "message-start",
      sessionId: a.id,
      messageId: "reply-a",
      message: { role: "assistant", content: [] },
    });
    emit({
      type: "message-update",
      sessionId: a.id,
      messageId: "reply-a",
      updates: [
        { type: "text-delta", contentIndex: 0, delta: "Background reply" },
      ],
    });
    emit({
      type: "compaction-start",
      sessionId: a.id,
      compactionId: "compact-a",
    });
    expect(store.pendingApprovals.map((item) => item.requestId)).toEqual([
      "b-1",
    ]);
    expect(store.messages).toEqual([]);
    expect(store.pendingQuestionnaires).toEqual([]);
    await store.respondApproval("approve", undefined, "a-1", a.id);
    expect(api.respondApproval).toHaveBeenCalledWith({
      requestId: "a-1",
      action: "approve",
      guidance: undefined,
    });
    expect(store.pendingApprovals.map((item) => item.requestId)).toEqual([
      "b-1",
    ]);
    emit({ type: "run-state", sessionId: b.id, state: "idle" });
    await store.resume(a.id);
    expect(store.isRunning).toBe(true);
    expect(store.pendingQuestionnaires[0]?.requestId).toBe("question-a");
    expect(store.messages[0]?.blocks).toEqual([
      { type: "text", text: "Background reply" },
    ]);
    expect(store.messages[1]?.blocks[0]?.type).toBe("compaction");
    expect(api.loadSessionMessages).toHaveBeenCalledTimes(2);
  });

  it("responds to each request once and preserves the next card across an in-flight response", async () => {
    const { store, api, emit } = fixture();
    await store.resume(a.id);
    emit(approval(a.id, "first"));
    emit(approval(a.id, "second"));
    const response = deferred<{ accepted: boolean }>();
    api.respondApproval.mockReturnValueOnce(response.promise);
    const first = store.respondApproval("approve", undefined, "first", a.id);
    await store.respondApproval("reject", undefined, "first", a.id);
    expect(api.respondApproval).toHaveBeenCalledTimes(1);
    await store.resume(b.id);
    response.resolve({ accepted: true });
    await first;
    expect(store.pendingApprovals).toEqual([]);
    expect(
      store.stateFor(a.id).pendingApprovals.map((item) => item.requestId),
    ).toEqual(["second"]);
    await store.respondApproval("approve", undefined, "second", a.id);
    expect(api.respondApproval).toHaveBeenLastCalledWith({
      requestId: "second",
      action: "approve",
      guidance: undefined,
    });
  });

  it.each([
    ["en-US", "Automatic approval failed"],
    ["zh-CN", "自动审批失败"],
  ])(
    "notifies once per failed batch in %s and preserves background failure cards",
    async (locale, title) => {
      document.documentElement.lang = locale;
      const { store, emit } = fixture();
      await store.resume(a.id);
      await store.resume(b.id);
      const failure = {
        id: "review-batch",
        message: "HTTP 429: quota exceeded",
      };
      for (const requestId of ["fallback-1", "fallback-2"]) {
        emit({
          type: "approval-request",
          sessionId: a.id,
          requestId,
          toolCallId: requestId,
          toolName: "bash",
          trigger: "sandbox-denied",
          autoApprovalFailure: failure,
        });
      }
      expect(store.pendingApprovals).toEqual([]);
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(title, {
        id: "auto-approval-failed-review-batch",
        description: failure.message,
      });
      await store.resume(a.id);
      expect(store.pendingApprovals).toHaveLength(2);
      expect(store.pendingApprovals[0]?.autoApprovalFailure).toEqual(failure);
      await store.respondApproval("approve", undefined, "fallback-1", a.id);
      expect(store.pendingApprovals[0]?.requestId).toBe("fallback-2");
      expect(store.pendingApprovals[0]?.autoApprovalFailure).toEqual(failure);
      expect(toast.error).toHaveBeenCalledTimes(1);
      emit({
        type: "approval-request",
        sessionId: a.id,
        requestId: "next-fallback",
        toolCallId: "next-fallback",
        toolName: "bash",
        trigger: "sandbox-denied",
        autoApprovalFailure: { ...failure, id: "next-batch" },
      });
      emit({
        type: "approval-request",
        sessionId: a.id,
        requestId: "late-fallback",
        toolCallId: "late-fallback",
        toolName: "bash",
        trigger: "sandbox-denied",
        autoApprovalFailure: failure,
      });
      expect(toast.error).toHaveBeenCalledTimes(2);
    },
  );

  it("does not notify for ordinary manual confirmations", async () => {
    const { store, emit } = fixture();
    await store.resume(a.id);
    emit(approval(a.id, "manual"));
    expect(store.pendingApprovals[0]?.autoApprovalFailure).toBeUndefined();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps a failed response available to retry", async () => {
    const { store, api, emit } = fixture();
    await store.resume(a.id);
    emit(approval(a.id, "first"));
    api.respondApproval.mockRejectedValueOnce(new Error("IPC failure"));
    await expect(store.respondApproval("approve")).rejects.toThrow(
      "IPC failure",
    );
    expect(store.pendingApprovals[0]?.requestId).toBe("first");
    expect(store.stateFor(a.id).respondingRequestIds.size).toBe(0);
    await store.respondApproval("approve");
    expect(store.pendingApprovals).toEqual([]);
  });

  it("merges live events into a late history response without replacing newer message content", async () => {
    const { store, api, emit } = fixture();
    const history = deferred<{
      messages: PineTextMessage[];
      hasMore: boolean;
    }>();
    api.loadSessionMessages.mockReturnValueOnce(history.promise);
    const loading = store.resume(a.id);
    await vi.waitFor(() =>
      expect(api.loadSessionMessages).toHaveBeenCalledOnce(),
    );
    emit({
      type: "message-start",
      sessionId: a.id,
      messageId: "reply",
      message: { role: "assistant", content: [{ type: "text", text: "Live" }] },
    });
    await store.resume(b.id);
    history.resolve({
      messages: [
        {
          id: "old",
          createdAt: a.createdAt,
          role: "user",
          blocks: [{ type: "text", text: "Question" }],
        },
        {
          id: "reply",
          createdAt: a.createdAt,
          role: "assistant",
          blocks: [{ type: "text", text: "Stale" }],
        },
      ],
      hasMore: false,
    });
    await loading;
    expect(store.activeSession?.id).toBe(b.id);
    await store.resume(a.id);
    expect(store.messages.map((message) => message.id)).toEqual([
      "old",
      "reply",
    ]);
    expect(store.messages[1]?.blocks).toEqual([{ type: "text", text: "Live" }]);
  });

  it("does not activate an older prompt result after switching tabs", async () => {
    const { store, api, emit } = fixture();
    const result = deferred<{
      accepted: boolean;
      session: PineSessionSummary;
    }>();
    api.promptSession.mockReturnValueOnce(result.promise);
    const prompting = store.prompt("Start A");
    await store.resume(b.id);
    emit({ type: "run-state", sessionId: a.id, state: "running" });
    emit(approval(a.id, "a-card"));
    result.resolve({ accepted: true, session: a });
    await prompting;
    expect(store.activeSession?.id).toBe(b.id);
    await store.resume(a.id);
    expect(store.isRunning).toBe(true);
    expect(store.pendingApprovals[0]?.requestId).toBe("a-card");
  });

  it("explicitly addresses controls even when another session is focused", async () => {
    const { store, api } = fixture();
    await store.resume(a.id);
    await store.resume(b.id);
    await store.abort(a.id);
    await store.compactContext(a.id);
    await store.setApprovalMode("let-me-review", a.id);
    await store.dequeueSteering("Change direction", a.id);
    expect(api.abortSession).toHaveBeenCalledWith({ sessionId: a.id });
    expect(api.compactSession).toHaveBeenCalledWith({ sessionId: a.id });
    expect(api.setApprovalMode).toHaveBeenCalledWith({
      sessionId: a.id,
      approvalMode: "let-me-review",
    });
    expect(api.dequeueSteering).toHaveBeenCalledWith({
      sessionId: a.id,
      message: "Change direction",
    });
  });

  it("keeps nested MCP approvals attached to their parent across tab switches", async () => {
    const { store, emit } = fixture();
    for (const summary of [a, b]) {
      await store.resume(summary.id);
      emit({
        type: "tool-start",
        sessionId: summary.id,
        toolCallId: "script",
        toolName: "mcpScript",
      });
      emit({
        type: "tool-review",
        sessionId: summary.id,
        toolCallId: "nested",
        toolName: "remote_tool",
        state: "reviewing",
      });
    }
    await store.resume(a.id);
    expect(store.reviewingToolCallIds.has("script")).toBe(true);
    emit({
      type: "approval-request",
      sessionId: a.id,
      requestId: "approval-a",
      toolCallId: "nested",
      toolName: "remote_tool",
      trigger: "pre-execution",
    });
    expect(store.pendingApprovals[0]?.toolCallId).toBe("script");
    await store.resume(b.id);
    emit({
      type: "approval-decided",
      sessionId: a.id,
      requestId: "approval-a",
      toolCallId: "nested",
      verdict: "denied",
      decidedBy: "user",
    });
    expect(store.reviewingToolCallIds.has("script")).toBe(true);
    const backgroundBlock = store.stateFor(a.id).messages[0]?.blocks[0];
    expect(
      backgroundBlock?.type === "toolCall" && backgroundBlock.toolCall.approval,
    ).toEqual({ state: "denied", decidedBy: "user" });
    emit({ type: "run-state", sessionId: a.id, state: "idle" });
    expect(store.reviewingToolCallIds.has("script")).toBe(true);
    await store.resume(a.id);
    expect(store.pendingApprovals).toEqual([]);
    expect(store.reviewingToolCallIds.size).toBe(0);
  });

  it("retains a closed running view and clears only its interactions when it fails", async () => {
    const { store, emit } = fixture();
    await store.resume(a.id);
    emit({ type: "run-state", sessionId: a.id, state: "running" });
    emit(approval(a.id, "a-card"));
    const state = store.stateFor(a.id);
    store.dropSessionCache(a.id);
    expect(store.stateFor(a.id)).toBe(state);
    await store.resume(b.id);
    emit(approval(b.id, "b-card"));
    emit({ type: "run-state", sessionId: a.id, state: "failed" });
    expect(state.pendingApprovals).toEqual([]);
    expect(store.pendingApprovals[0]?.requestId).toBe("b-card");
  });
});
