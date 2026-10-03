import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskState } from "@pine/rpiv-todo";
import type { PineAgentEvent } from "@/shared/agent";
import type { PineSessionSummary } from "@/shared/sessions";
import { useSessionStore } from "../session";

const PROJECT_ID = "7f48c81c-f1dc-4be6-a8ee-55729ef647ba";

const session: PineSessionSummary = {
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
  messageCount: 1,
};

const replayed: TaskState = {
  tasks: [
    { id: 1, subject: "Research", status: "completed" },
    { id: 2, subject: "Build", status: "in_progress", activeForm: "building" },
  ],
  nextId: 3,
};

async function resumedStore() {
  let listener: ((event: PineAgentEvent) => void) | undefined;
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      loadSessionMessages: vi.fn().mockResolvedValue({
        hasMore: false,
        messages: [],
        todos: replayed,
      }),
      onSessionEvent: vi.fn((callback: (event: PineAgentEvent) => void) => {
        listener = callback;
        return () => undefined;
      }),
      resumeSession: vi.fn().mockResolvedValue({ session }),
    },
  });
  const store = useSessionStore();
  store.connectAgentEvents();
  await store.resume(PROJECT_ID, session.id);
  return {
    store,
    emit: (event: PineAgentEvent) => listener?.(event),
  };
}

function todoEnd(state: TaskState, isError = false): PineAgentEvent {
  return {
    type: "tool-end",
    sessionId: session.id,
    toolCallId: `todo-${state.nextId}-${state.tasks.length}`,
    toolName: "todo",
    isError,
    payload: {
      content: [{ type: "text", text: "Updated" }],
      details: { action: "update", params: {}, ...state },
    } as never,
  };
}

function runState(state: "running" | "idle"): PineAgentEvent {
  return { type: "run-state", sessionId: session.id, state };
}

describe("session todos", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("restores the replayed list with the first history page", async () => {
    const { store } = await resumedStore();

    expect(store.todos).toEqual(replayed);
    expect([...store.hiddenCompletedTodoIds]).toEqual([]);
  });

  it("replaces the list with each successful todo result", async () => {
    const { store, emit } = await resumedStore();
    const next: TaskState = {
      tasks: [...replayed.tasks, { id: 3, subject: "Ship", status: "pending" }],
      nextId: 4,
    };

    emit(todoEnd(next));
    emit(todoEnd({ tasks: [], nextId: 1 }, true));

    expect(store.todos).toEqual(next);
  });

  it("hides completed tasks when the next run starts", async () => {
    const { store, emit } = await resumedStore();

    emit(runState("running"));
    expect([...store.hiddenCompletedTodoIds]).toEqual([1]);

    // Completing a task mid-run keeps it visible for the rest of the run.
    emit(
      todoEnd({
        tasks: [
          replayed.tasks[0],
          { ...replayed.tasks[1], status: "completed" },
        ],
        nextId: 3,
      }),
    );
    expect([...store.hiddenCompletedTodoIds]).toEqual([1]);

    emit(runState("idle"));
    emit(runState("running"));
    expect([...store.hiddenCompletedTodoIds]).toEqual([1, 2]);

    // A cleared list restarts its ids, so the old hidden ids are dropped.
    emit(
      todoEnd({
        tasks: [{ id: 1, subject: "Fresh", status: "completed" }],
        nextId: 2,
      }),
    );
    expect([...store.hiddenCompletedTodoIds]).toEqual([]);
  });
});
