import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { useSessionStore } from "../session";
import { useBackgroundTasksStore } from "../backgroundTasks";

const session = {
  id: "session-a",
  createdAt: "",
  updatedAt: "",
  messageCount: 0,
};
function task(
  overrides: Partial<BackgroundTaskSnapshot> = {},
): BackgroundTaskSnapshot {
  return {
    id: "b1234abcd",
    name: "Build",
    command: "bun run build",
    status: "running",
    cwd: "/project",
    outputPath: "/tmp/build.output",
    startTime: 1000,
    bytesWritten: 0,
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
    privileged: false,
    ...overrides,
  };
}
function update(tasks: BackgroundTaskSnapshot[], sessionId = session.id) {
  useBackgroundTasksStore().handleEvent({
    type: "background-tasks",
    sessionId,
    tasks,
  });
}

describe("background tasks store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useSessionStore().activeSession = session;
  });

  it("isolates tasks by session and sorts running tasks first", () => {
    update([task({ id: "done", status: "completed" }), task()]);
    update([task({ id: "other" })], "session-b");
    const store = useBackgroundTasksStore();
    expect(store.tasks.map((value) => value.id)).toEqual(["b1234abcd", "done"]);
    expect(store.runningCount).toBe(1);
    store.inspect("done");
    useSessionStore().activeSession = { ...session, id: "session-b" };
    expect(store.inspectedTaskId).toBeNull();
    expect(store.tasks.map((value) => value.id)).toEqual(["other"]);
  });

  it("refreshes cached tasks when returning after disconnection", async () => {
    update([task()]);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listBackgroundTasks: vi
          .fn()
          .mockResolvedValue({ tasks: [task({ status: "completed" })] }),
      },
    });
    await useBackgroundTasksStore().load(session.id);
    expect(useBackgroundTasksStore().tasks[0]?.status).toBe("completed");
  });

  it("keeps an event newer than a pending list response", async () => {
    let resolve!: (value: { tasks: BackgroundTaskSnapshot[] }) => void;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listBackgroundTasks: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    const store = useBackgroundTasksStore();
    const loading = store.load(session.id);
    update([task({ status: "failed" })]);
    resolve({ tasks: [task()] });
    await loading;
    expect(store.tasks[0]?.status).toBe("failed");
  });

  it("discards a list response from the previous project", async () => {
    let resolve!: (value: { tasks: BackgroundTaskSnapshot[] }) => void;
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        listBackgroundTasks: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    const store = useBackgroundTasksStore();
    const loading = store.load(session.id);
    store.reset();
    resolve({ tasks: [task()] });
    await loading;
    expect(store.tasks).toEqual([]);
  });

  it("connects once and disconnects the event listener", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn().mockReturnValue(unsubscribe);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { onSessionEvent: subscribe },
    });
    const store = useBackgroundTasksStore();
    store.connect();
    store.connect();
    expect(subscribe).toHaveBeenCalledTimes(1);
    store.disconnect();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("addresses panel actions to the active session", async () => {
    const pine = {
      stopBackgroundTask: vi.fn().mockResolvedValue({ task: task() }),
      readBackgroundTaskOutput: vi.fn().mockResolvedValue({ content: "hello" }),
    };
    Object.defineProperty(window, "pine", { configurable: true, value: pine });
    const store = useBackgroundTasksStore();
    await store.stop(task().id);
    await store.readOutput(task().id);
    for (const method of [
      pine.stopBackgroundTask,
      pine.readBackgroundTaskOutput,
    ])
      expect(method).toHaveBeenCalledWith({
        sessionId: session.id,
        taskId: task().id,
      });
  });
});
