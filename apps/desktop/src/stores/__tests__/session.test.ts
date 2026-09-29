import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_DENIED_MESSAGE, type PineAgentEvent } from "@/shared/agent";
import type { PineContextUsage, PineSessionSummary } from "@/shared/sessions";
import { useModelsStore } from "../models";
import { useSessionStore } from "../session";

const session: PineSessionSummary = {
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  messageCount: 1,
  name: "Session search",
};

const contextUsage: PineContextUsage = {
  tokens: 86_400,
  contextWindow: 200_000,
  percent: 43.2,
  cost: 0.1234,
  cacheHitRate: null,
};

describe("session store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.documentElement.lang = "en-US";
  });

  it("keeps the newest search response when requests finish out of order", async () => {
    let resolveFirst: ((value: { sessions: [] }) => void) | undefined;
    const firstResult = new Promise<{ sessions: [] }>((resolve) => {
      resolveFirst = resolve;
    });
    const searchSessions = vi
      .fn()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({ sessions: [session] });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { searchSessions },
    });
    const store = useSessionStore();

    const firstSearch = store.search("old");
    await store.search("new");
    resolveFirst?.({ sessions: [] });
    await firstSearch;

    expect(store.searchResults).toEqual([session]);
    expect(store.isSearching).toBe(false);
  });

  it("activates a resumed session", async () => {
    const sessionWithModel: PineSessionSummary = {
      ...session,
      modelSelection: {
        providerId: "anthropic",
        modelId: "claude-sonnet",
        thinkingLevel: "high",
      },
    };
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        resumeSession: vi
          .fn()
          .mockResolvedValue({ session: sessionWithModel, contextUsage }),
      },
    });
    const store = useSessionStore();

    await expect(store.resume(session.id)).resolves.toEqual(sessionWithModel);
    expect(store.activeSession).toEqual(sessionWithModel);
    expect(store.contextUsage).toEqual(contextUsage);
    expect(useModelsStore().selectionFor(session.id)).toEqual(
      sessionWithModel.modelSelection,
    );
  });

  it("reuses the cached transcript array across resumes without re-fetching", async () => {
    const loadedMessages = [
      {
        id: "m1",
        blocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        role: "assistant" as const,
      },
    ];
    const loadSessionMessages = vi.fn().mockResolvedValue({
      hasMore: false,
      messages: loadedMessages,
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages,
        resumeSession: vi.fn().mockResolvedValue({ session, contextUsage }),
      },
    });
    const store = useSessionStore();

    await store.resume(session.id);
    const firstArray = store.messages;
    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(store.isLoadingMessages).toBe(false);
    expect(store.contextUsage).toEqual(contextUsage);

    useModelsStore().setSessionSelection(session.id, {
      providerId: "provider-b",
      modelId: "model-b",
      thinkingLevel: "high",
    });

    // Switching back to the same session restores the same array reference and
    // its persisted usage snapshot without re-fetching from disk.
    store.startDraft();
    expect(store.contextUsage).toBeNull();
    await store.resume(session.id);
    expect(store.messages).toBe(firstArray);
    expect(store.contextUsage).toEqual(contextUsage);
    expect(useModelsStore().selectionFor(session.id)).toEqual({
      providerId: "provider-b",
      modelId: "model-b",
      thinkingLevel: "high",
    });
    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(store.isLoadingMessages).toBe(false);
  });

  it("applies background stream events without reloading its cached transcript", async () => {
    const updatedMessage = {
      id: "reply",
      blocks: [{ type: "text" as const, text: "Latest reply" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      role: "assistant" as const,
    };
    const loadSessionMessages = vi
      .fn()
      .mockResolvedValueOnce({ hasMore: false, messages: [] })
      .mockResolvedValueOnce({ hasMore: false, messages: [updatedMessage] });
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages,
        resumeSession: vi.fn().mockResolvedValue({ session }),
        onSessionEvent: vi.fn((callback) => {
          listener = callback;
          return () => undefined;
        }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.resume(session.id);
    store.startDraft();
    listener?.({ type: "run-state", sessionId: session.id, state: "running" });
    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: updatedMessage.id,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Latest reply" }],
      },
    });

    await store.resume(session.id);

    expect(loadSessionMessages).toHaveBeenCalledTimes(1);
    expect(store.messages[0]?.blocks).toEqual(updatedMessage.blocks);
    expect(store.isRunning).toBe(true);
  });

  it("loads the earlier page with the cursor returned by the initial page", async () => {
    const newerMessage = {
      id: "newer-message",
      blocks: [],
      createdAt: "2026-01-02T00:00:00.000Z",
      role: "assistant" as const,
    };
    const earlierMessage = {
      id: "earlier-message",
      blocks: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      role: "user" as const,
    };
    const loadSessionMessages = vi
      .fn()
      .mockResolvedValueOnce({
        hasMore: true,
        messages: [newerMessage],
        nextBefore: "newer-message",
      })
      .mockResolvedValueOnce({
        hasMore: false,
        messages: [earlierMessage],
      });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages,
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();

    await store.resume(session.id);
    await store.loadEarlierMessages();

    expect(loadSessionMessages).toHaveBeenNthCalledWith(2, {
      before: "newer-message",
      sessionId: session.id,
      limit: 50,
    });
    expect(store.messages.map((message) => message.id)).toEqual([
      "earlier-message",
      "newer-message",
    ]);
    expect(store.hasEarlierMessages).toBe(false);
  });

  it("lets a navigation wait for an in-flight history page", async () => {
    const newer = {
      id: "newer",
      blocks: [],
      createdAt: "2026-01-02T00:00:00.000Z",
      role: "assistant" as const,
    };
    const older = { ...newer, id: "older" };
    let resolvePage:
      | ((value: { hasMore: false; messages: (typeof older)[] }) => void)
      | undefined;
    const pendingPage = new Promise<{
      hasMore: false;
      messages: (typeof older)[];
    }>((resolve) => {
      resolvePage = resolve;
    });
    const loadSessionMessages = vi
      .fn()
      .mockResolvedValueOnce({
        hasMore: true,
        messages: [newer],
        nextBefore: "newer",
      })
      .mockReturnValueOnce(pendingPage);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages,
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    await store.resume(session.id);

    const first = store.loadEarlierMessages();
    const second = store.loadEarlierMessages();
    let secondFinished = false;
    void second.then(() => {
      secondFinished = true;
    });
    await Promise.resolve();
    expect(loadSessionMessages).toHaveBeenCalledTimes(2);
    expect(secondFinished).toBe(false);

    resolvePage?.({ hasMore: false, messages: [older] });
    await Promise.all([first, second]);
    expect(secondFinished).toBe(true);
    expect(store.messages.map((message) => message.id)).toEqual([
      "older",
      "newer",
    ]);
  });

  it("keeps the complete outline separate from the paginated transcript", async () => {
    const newerMessage = {
      id: "newer-message",
      blocks: [],
      createdAt: "2026-01-02T00:00:00.000Z",
      role: "assistant" as const,
    };
    const earlierTurn = {
      id: "earlier-turn",
      blocks: [{ type: "text" as const, text: "Earlier" }],
      createdAt: "2026-01-01T00:00:00.000Z",
      role: "user" as const,
    };
    const currentTurn = {
      id: "current-turn",
      blocks: [{ type: "text" as const, text: "Current" }],
      createdAt: "2026-01-02T00:00:00.000Z",
      role: "user" as const,
    };
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: true,
          messages: [newerMessage],
          nextBefore: "newer-message",
          outline: [earlierTurn, currentTurn],
        }),
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();

    await store.resume(session.id);

    expect(store.messages.map((message) => message.id)).toEqual([
      "newer-message",
    ]);
    expect(store.outlineMessages.map((message) => message.id)).toEqual([
      "earlier-turn",
      "current-turn",
    ]);
  });

  it("evicts a session from the cache when it is deleted", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();

    await store.resume(session.id);
    await store.deleteSession(session.id);

    // Re-resume must re-fetch because the cached slice was dropped.
    expect(store.messages).toEqual([]);
  });

  it("keeps the indexed title when the live resume summary omits it", async () => {
    const liveSession = { ...session };
    delete liveSession.name;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        resumeSession: vi.fn().mockResolvedValue({ session: liveSession }),
      },
    });
    const store = useSessionStore();
    store.recentSessions = [session];

    await store.resume(session.id);

    expect(store.activeSession?.name).toBe("Session search");
  });

  it("loads recent sessions separately from search results", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
      },
    });
    const store = useSessionStore();

    await expect(store.loadRecent()).resolves.toEqual([session]);

    expect(store.recentSessions).toEqual([session]);
    expect(store.searchResults).toEqual([]);
    expect(store.isLoadingRecent).toBe(false);
  });

  it("renames a session across recent, search, active, and cached state", async () => {
    const renamed = {
      ...session,
      name: "Renamed conversation",
      updatedAt: "2026-07-14T00:01:00.000Z",
    };
    const renameSession = vi.fn().mockResolvedValue({ session: renamed });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        renameSession,
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.recentSessions = [session];
    store.searchResults = [{ ...session, snippet: "matching text" }];
    await store.resume(session.id);

    await expect(
      store.renameSession(session.id, "Renamed conversation"),
    ).resolves.toEqual(renamed);

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: session.id,
      name: "Renamed conversation",
    });
    expect(store.recentSessions[0]?.name).toBe("Renamed conversation");
    expect(store.searchResults[0]).toEqual(
      expect.objectContaining({
        name: "Renamed conversation",
        snippet: "matching text",
      }),
    );
    expect(store.activeSession?.name).toBe("Renamed conversation");

    store.startDraft();
    await store.resume(session.id);
    expect(store.activeSession?.name).toBe("Renamed conversation");
  });

  it("starts a new session without persisting it", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    await store.resume(session.id);

    store.startDraft();

    expect(store.activeSession).toBeNull();
  });

  it("adds a newly prompted session to the recent list immediately", async () => {
    const promptSession = vi.fn().mockResolvedValue({ session });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        promptSession,
      },
    });
    const store = useSessionStore();

    await store.prompt("Describe the task");

    expect(store.recentSessions).toEqual([
      expect.objectContaining({
        id: session.id,
        preview: "Describe the task",
      }),
    ]);
    expect(store.activeSession?.id).toBe(session.id);
    expect(promptSession).toHaveBeenCalledWith({
      locale: "en-US",
      message: "Describe the task",
      target: { kind: "new" },
    });
  });

  it("passes the current interface language to title generation", async () => {
    document.documentElement.lang = "zh-CN";
    const promptSession = vi.fn().mockResolvedValue({ session });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { promptSession },
    });

    await useSessionStore().prompt("描述任务");

    expect(promptSession).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "zh-CN" }),
    );
  });

  it("targets the active session when sending a follow-up", async () => {
    const promptSession = vi.fn().mockResolvedValue({ session });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        promptSession,
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    await store.resume(session.id);

    await store.prompt("Continue here", session.id);

    expect(promptSession).toHaveBeenCalledWith({
      locale: "en-US",
      message: "Continue here",
      target: { kind: "session", sessionId: session.id },
    });
  });

  it("queues steering on the active session and exposes pi queue updates", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    const promptSession = vi.fn().mockResolvedValue({ session });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession,
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.resume(session.id);

    await store.prompt("Change direction", session.id, "auto-approve", "steer");
    listener?.({
      type: "steering-queue",
      sessionId: session.id,
      messages: ["Change direction"],
    });

    expect(promptSession).toHaveBeenCalledWith({
      locale: "en-US",
      message: "Change direction",
      target: { kind: "session", sessionId: session.id },
      approvalMode: "auto-approve",
      streamingBehavior: "steer",
    });
    expect(store.steeringMessages).toEqual(["Change direction"]);
  });

  it("dequeues a staged steering message through the preload API", async () => {
    const dequeueSteering = vi.fn().mockResolvedValue({
      message: "Change direction",
      removed: true,
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { dequeueSteering },
    });
    const store = useSessionStore();

    await expect(
      store.dequeueSteering("Change direction", session.id),
    ).resolves.toBe("Change direction");
    expect(dequeueSteering).toHaveBeenCalledWith({
      message: "Change direction",
      sessionId: session.id,
    });
  });

  it("syncs approval mode changes immediately", async () => {
    const setApprovalMode = vi.fn().mockResolvedValue({ updated: true });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { setApprovalMode },
    });
    const store = useSessionStore();

    await store.setApprovalMode("YOLO", session.id);

    expect(setApprovalMode).toHaveBeenCalledWith({
      approvalMode: "YOLO",
      sessionId: session.id,
    });
  });

  it("removes a deleted session and clears it when active", async () => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.recentSessions = [session];
    await store.resume(session.id);

    await expect(store.deleteSession(session.id)).resolves.toBe(true);

    expect(store.recentSessions).toEqual([]);
    expect(store.activeSession).toBeNull();
    expect(store.messages).toEqual([]);
  });

  it("builds a text transcript from streaming agent events", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    let resolvePrompt:
      ((value: { session: PineSessionSummary }) => void) | undefined;
    const promptResult = new Promise<{ session: PineSessionSummary }>(
      (resolve) => {
        resolvePrompt = resolve;
      },
    );
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockReturnValue(promptResult),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    const prompt = store.prompt("Hello");

    listener?.({
      type: "run-state",
      sessionId: session.id,
      state: "running",
    });
    listener?.({
      type: "message-start",
      sessionId: session.id,
      messageId: "019cfe51-7166-79b9-a5b9-c652fcca9eac",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [{ type: "text", text: "Hello" }],
      },
    });
    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: "019cfe51-7166-79b9-a5b9-c652fcca9eac",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [
          { type: "thinking", thinking: "Check the incoming message." },
          { type: "text", text: "Hello, world" },
        ],
      },
    });
    resolvePrompt?.({ session });
    await prompt;

    expect(store.messages).toEqual([
      expect.objectContaining({
        id: "019cfe51-7166-79b9-a5b9-c652fcca9eac",
        role: "assistant",
        status: "complete",
        blocks: [
          { type: "thinking", thinking: "Check the incoming message." },
          { type: "text", text: "Hello, world" },
        ],
      }),
    ]);
    expect(store.isRunning).toBe(true);
  });

  it("surfaces model and runtime errors in the transcript", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Try the provider");

    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: "model-error",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [],
        stopReason: "error",
        errorMessage: "Rate limit exceeded",
      },
    });
    listener?.({
      type: "session-error",
      sessionId: session.id,
      errorId: "compaction-error",
      message: "Compaction failed",
    });

    expect(store.messages).toEqual([
      expect.objectContaining({
        id: "model-error",
        blocks: [{ type: "error", error: { message: "Rate limit exceeded" } }],
      }),
      expect.objectContaining({
        id: "error-compaction-error",
        blocks: [{ type: "error", error: { message: "Compaction failed" } }],
      }),
    ]);
  });

  it("tracks compaction progress in the transcript", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Keep working");

    listener?.({
      type: "compaction-start",
      sessionId: session.id,
      compactionId: "compaction-1",
    });
    expect(store.messages).toEqual([
      expect.objectContaining({
        id: "compaction-compaction-1",
        status: "streaming",
        blocks: [
          {
            type: "compaction",
            compaction: { id: "compaction-1", status: "running" },
          },
        ],
      }),
    ]);

    listener?.({
      type: "compaction-end",
      sessionId: session.id,
      compactionId: "compaction-1",
      status: "complete",
    });
    expect(store.messages[0]).toEqual(
      expect.objectContaining({
        id: "compaction-compaction-1",
        status: "complete",
        blocks: [
          {
            type: "compaction",
            compaction: { id: "compaction-1", status: "complete" },
          },
        ],
      }),
    );
  });

  it("tracks thinking completion and tool execution by call id", async () => {
    vi.useFakeTimers();
    try {
      let listener: ((event: PineAgentEvent) => void) | undefined;
      let resolvePrompt:
        ((value: { session: PineSessionSummary }) => void) | undefined;
      const promptResult = new Promise<{ session: PineSessionSummary }>(
        (resolve) => {
          resolvePrompt = resolve;
        },
      );
      Object.defineProperty(window, "pine", {
        configurable: true,
        value: {
          onSessionEvent: vi.fn((nextListener) => {
            listener = nextListener;
            return () => undefined;
          }),
          promptSession: vi.fn().mockReturnValue(promptResult),
        },
      });
      const store = useSessionStore();
      store.connectAgentEvents();
      const prompt = store.prompt("Inspect the file");
      const messageId = "assistant-with-tool";

      listener?.({
        type: "run-state",
        sessionId: session.id,
        state: "running",
      });
      vi.setSystemTime(1_000);
      listener?.({
        type: "message-update",
        sessionId: session.id,
        messageId,
        updates: [
          { type: "thinking-start", contentIndex: 0, thinking: "" },
          {
            type: "thinking-delta",
            contentIndex: 0,
            delta: "Inspect.\nRead the file.",
          },
        ],
      });
      vi.setSystemTime(3_500);
      listener?.({
        type: "message-update",
        sessionId: session.id,
        messageId,
        updates: [
          {
            type: "thinking-end",
            contentIndex: 0,
            thinking: "Inspect.\nRead the file.",
          },
        ],
      });
      listener?.({
        type: "message-end",
        sessionId: session.id,
        messageId,
        message: {
          role: "assistant",
          timestamp: 500,
          content: [
            { type: "thinking", thinking: "Inspect.\nRead the file." },
            {
              type: "toolCall",
              id: "call-read",
              name: "read",
              arguments: { path: "/project/src/main.ts" },
            },
          ],
        },
      });
      listener?.({
        type: "tool-start",
        sessionId: session.id,
        toolCallId: "call-read",
        toolName: "read",
        payload: { path: "/project/src/main.ts" },
      });
      vi.setSystemTime(4_500);
      listener?.({
        type: "tool-end",
        sessionId: session.id,
        toolCallId: "call-read",
        toolName: "read",
        payload: { content: [{ type: "text", text: "export {}" }] },
        isError: false,
      });
      resolvePrompt?.({ session });
      await prompt;

      expect(store.messages).toEqual([
        expect.objectContaining({
          id: messageId,
          thinkingDurationMs: 2_500,
          thinkingStatus: "complete",
          blocks: [
            { type: "thinking", thinking: "Inspect.\nRead the file." },
            {
              type: "toolCall",
              toolCall: expect.objectContaining({
                durationMs: 1_000,
                id: "call-read",
                input: { path: "/project/src/main.ts" },
                status: "complete",
              }),
            },
          ],
        }),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows bounded live tool argument previews before execution", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ accepted: true, session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("go");
    const sessionId = session.id;
    const messageId = "assistant-streaming-tool";

    listener?.({ type: "run-state", sessionId, state: "running" });
    listener?.({
      type: "message-update",
      sessionId,
      messageId,
      updates: [
        {
          type: "tool-call-start",
          contentIndex: 0,
          id: "call-bash",
          name: "bash",
        },
      ],
    });
    let blocks = store.messages[0]?.blocks ?? [];
    expect(
      blocks[0]?.type === "toolCall" && blocks[0].toolCall.input,
    ).toBeUndefined();

    // The utility process adds a parsed preview to bounded raw-delta batches.
    listener?.({
      type: "message-update",
      sessionId,
      messageId,
      updates: [
        {
          type: "tool-call-delta",
          contentIndex: 0,
          delta: '{"command":"bun run check"}',
          input: { command: "bun run check" },
        },
      ],
    });
    blocks = store.messages[0]?.blocks ?? [];
    expect(blocks[0]?.type === "toolCall" && blocks[0].toolCall.input).toEqual({
      command: "bun run check",
    });

    listener?.({
      type: "message-update",
      sessionId,
      messageId,
      updates: [
        {
          type: "tool-call-end",
          contentIndex: 0,
          id: "call-bash",
          name: "bash",
          input: { command: "bun run check" },
        },
      ],
    });
    blocks = store.messages[0]?.blocks ?? [];
    expect(blocks[0]?.type === "toolCall" && blocks[0].toolCall.input).toEqual({
      command: "bun run check",
    });

    // Execution start pins the complete payload without regressions.
    listener?.({
      type: "tool-start",
      sessionId,
      toolCallId: "call-bash",
      toolName: "bash",
      payload: { command: "bun run check", description: "Checks types" },
    });
    blocks = store.messages[0]?.blocks ?? [];
    expect(blocks[0]?.type === "toolCall" && blocks[0].toolCall.input).toEqual({
      command: "bun run check",
      description: "Checks types",
    });
  });

  it("applies a large coalesced text stream without cumulative snapshots", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ accepted: true, session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("go");

    listener?.({
      type: "message-update",
      sessionId: session.id,
      messageId: "long-response",
      updates: [
        { type: "text-start", contentIndex: 0, text: "" },
        {
          type: "text-delta",
          contentIndex: 0,
          delta: "x".repeat(1_000),
        },
      ],
    });

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]?.blocks).toEqual([
      { type: "text", text: "x".repeat(1_000) },
    ]);
  });

  it("keeps the prompt title when a runtime summary omits display fields", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Describe the task");

    const summaryWithoutDisplayFields = { ...session };
    delete summaryWithoutDisplayFields.name;
    listener?.({
      type: "session-updated",
      sessionId: session.id,
      summary: summaryWithoutDisplayFields,
    });

    expect(store.activeSession?.preview).toBe("Describe the task");
    expect(store.recentSessions[0]?.preview).toBe("Describe the task");
  });

  it("ignores late events from a session after opening a new tab", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        loadSessionMessages: vi.fn().mockResolvedValue({
          hasMore: false,
          messages: [],
        }),
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        resumeSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.resume(session.id);
    store.startDraft();

    listener?.({
      type: "run-state",
      sessionId: session.id,
      state: "running",
    });
    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: "019cfe51-7166-79b9-a5b9-c652fcca9ead",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [{ type: "text", text: "Late response" }],
      },
    });

    expect(store.activeSession).toBeNull();
    expect(store.messages).toEqual([]);
    expect(store.isRunning).toBe(false);
  });

  it("tracks context usage for the active session only", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Hello", session.id);

    listener?.({
      type: "context-usage",
      sessionId: "another-session",
      tokens: 1,
      contextWindow: 200_000,
      percent: 0.5,
      cost: 0.01,
      cacheHitRate: null,
    });
    expect(store.contextUsage).toBeNull();

    listener?.({
      type: "context-usage",
      sessionId: session.id,
      tokens: 86_400,
      contextWindow: 200_000,
      percent: 43.2,
      cost: 0.1234,
      cacheHitRate: 75.5,
    });

    expect(store.contextUsage).toEqual({
      tokens: 86_400,
      contextWindow: 200_000,
      percent: 43.2,
      cost: 0.1234,
      cacheHitRate: 75.5,
    });
  });

  it("keeps automatic approval decisions with their tool calls", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Run it", session.id);

    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: "assistant-tool-review",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [
          {
            type: "toolCall",
            id: "call-reviewed",
            name: "bash",
            arguments: { command: "dangerous-command" },
          },
        ],
      },
    });
    listener?.({
      type: "tool-review",
      sessionId: session.id,
      toolCallId: "call-reviewed",
      toolName: "bash",
      state: "reviewing",
    });

    let block = store.messages[0]?.blocks[0];
    expect(block?.type === "toolCall" && block.toolCall.approval).toEqual({
      state: "reviewing",
    });

    listener?.({
      type: "approval-decided",
      sessionId: session.id,
      requestId: "judge-1",
      toolCallId: "call-reviewed",
      verdict: "denied",
      decidedBy: "judge",
      reason: "Use a safer command.",
    });

    block = store.messages[0]?.blocks[0];
    expect(block?.type === "toolCall" && block.toolCall.approval).toEqual({
      state: "denied",
      decidedBy: "judge",
      reason: "Use a safer command.",
    });
  });

  it("reclassifies a sandbox-denied tool result as a denial", async () => {
    let listener: ((event: PineAgentEvent) => void) | undefined;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        onSessionEvent: vi.fn((nextListener) => {
          listener = nextListener;
          return () => undefined;
        }),
        promptSession: vi.fn().mockResolvedValue({ session }),
      },
    });
    const store = useSessionStore();
    store.connectAgentEvents();
    await store.prompt("Run it", session.id);

    listener?.({
      type: "message-end",
      sessionId: session.id,
      messageId: "assistant-sandbox-denied",
      message: {
        role: "assistant",
        timestamp: 1_784_000_000_000,
        content: [
          {
            type: "toolCall",
            id: "call-bash",
            name: "bash",
            arguments: { command: "ps" },
          },
        ],
      },
    });
    listener?.({
      type: "tool-start",
      sessionId: session.id,
      toolCallId: "call-bash",
      toolName: "bash",
      payload: { command: "ps" },
    });
    listener?.({
      type: "tool-end",
      sessionId: session.id,
      toolCallId: "call-bash",
      toolName: "bash",
      payload: {
        content: [
          {
            type: "text",
            text: `${SANDBOX_DENIED_MESSAGE} Use privileged_bash for this operation.`,
          },
        ],
      },
      isError: true,
    });

    const block = store.messages[0]?.blocks[0];
    expect(block?.type === "toolCall" && block.toolCall).toEqual(
      expect.objectContaining({
        status: "error",
        approval: { state: "denied", decidedBy: "sandbox" },
      }),
    );
  });
});
