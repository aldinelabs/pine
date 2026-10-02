import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import {
  sortTasksForDisplay,
  type BackgroundTaskSnapshot,
} from "@pine/pi-background-tasks";
import type { ReadBackgroundTaskOutputResult } from "@/shared/backgroundTasks";
import type { PineSessionEvent } from "@/shared/agent";
import { useSessionStore } from "@/stores/session";

const NO_TASKS: readonly BackgroundTaskSnapshot[] = [];
const NONE_SEEN: ReadonlySet<string> = new Set();

/**
 * The background tasks of each live session. Tasks live in the agent process;
 * this mirrors them from `background-tasks` events and tracks which finished
 * tasks the user has looked at, like upstream's unread markers.
 */
export const useBackgroundTasksStore = defineStore("backgroundTasks", () => {
  const sessionStore = useSessionStore();
  const tasksBySession = reactive(
    new Map<string, readonly BackgroundTaskSnapshot[]>(),
  );
  const seenBySession = reactive(new Map<string, ReadonlySet<string>>());
  let generation = 0;
  const revisions = new Map<string, number>();
  let stopEvents: (() => void) | null = null;
  /** The task whose details are open, from the panel or a transcript notice. */
  const inspectedTaskId = ref<string | null>(null);

  const sessionId = computed(() => sessionStore.activeSession?.id ?? null);
  /** Running tasks first, then failures, stops, and completions. */
  const tasks = computed(() => {
    const current = sessionId.value
      ? tasksBySession.get(sessionId.value)
      : undefined;
    return sortTasksForDisplay<BackgroundTaskSnapshot>(current ?? NO_TASKS);
  });
  const seenIds = computed<ReadonlySet<string>>(() => {
    const current = sessionId.value
      ? seenBySession.get(sessionId.value)
      : undefined;
    return current ?? NONE_SEEN;
  });
  const runningCount = computed(
    () => tasks.value.filter((task) => task.status === "running").length,
  );
  const unseenFinishedIds = computed(
    () =>
      new Set(
        tasks.value
          .filter(
            (task) => task.status !== "running" && !seenIds.value.has(task.id),
          )
          .map((task) => task.id),
      ),
  );

  function setTasks(
    targetSessionId: string,
    next: readonly BackgroundTaskSnapshot[],
  ): void {
    revisions.set(targetSessionId, (revisions.get(targetSessionId) ?? 0) + 1);
    tasksBySession.set(targetSessionId, next);
    const seen = seenBySession.get(targetSessionId);
    if (seen) {
      const retained = new Set(next.map((task) => task.id));
      seenBySession.set(
        targetSessionId,
        new Set([...seen].filter((id) => retained.has(id))),
      );
    }
  }

  function handleEvent(event: PineSessionEvent): void {
    if (event.type === "background-tasks")
      setTasks(event.sessionId, event.tasks);
  }

  function connect(): void {
    if (stopEvents || !window.pine?.onSessionEvent) return;
    stopEvents = window.pine.onSessionEvent(handleEvent);
  }

  function disconnect(): void {
    stopEvents?.();
    stopEvents = null;
  }

  /** Fetch a session's tasks once, for a session first shown after they changed. */
  async function load(targetSessionId: string): Promise<void> {
    const currentGeneration = generation;
    const revision = revisions.get(targetSessionId) ?? 0;
    const result = await window.pine.listBackgroundTasks({
      sessionId: targetSessionId,
    });
    // An event that arrived meanwhile is at least as new.
    if (
      generation === currentGeneration &&
      (revisions.get(targetSessionId) ?? 0) === revision
    ) {
      setTasks(targetSessionId, result.tasks);
    }
  }

  function markSeen(taskIds: Iterable<string>): void {
    const id = sessionId.value;
    if (!id) return;
    const next = new Set(seenBySession.get(id) ?? []);
    let changed = false;
    for (const taskId of taskIds) {
      if (next.has(taskId)) continue;
      next.add(taskId);
      changed = true;
    }
    if (changed) seenBySession.set(id, next);
  }

  function markAllFinishedSeen(): void {
    markSeen(unseenFinishedIds.value);
  }

  function requireSessionId(): string {
    const id = sessionId.value;
    if (!id) throw new Error("No session is open.");
    return id;
  }

  async function stop(taskId: string): Promise<BackgroundTaskSnapshot> {
    const { task } = await window.pine.stopBackgroundTask({
      sessionId: requireSessionId(),
      taskId,
    });
    return task;
  }

  function stopAll(): Promise<{ stopped: number; failures: string[] }> {
    return window.pine.stopAllBackgroundTasks({
      sessionId: requireSessionId(),
    });
  }

  async function rerun(taskId: string): Promise<BackgroundTaskSnapshot> {
    const { task } = await window.pine.rerunBackgroundTask({
      sessionId: requireSessionId(),
      taskId,
    });
    return task;
  }

  function readOutput(taskId: string): Promise<ReadBackgroundTaskOutputResult> {
    return window.pine.readBackgroundTaskOutput({
      sessionId: requireSessionId(),
      taskId,
    });
  }

  function inspect(taskId: string | null): void {
    inspectedTaskId.value = taskId;
    if (
      tasks.value.some(
        (task) => task.id === taskId && task.status !== "running",
      )
    ) {
      markSeen([taskId!]);
    }
  }

  watch(
    sessionId,
    () => {
      inspectedTaskId.value = null;
    },
    { flush: "sync" },
  );
  watch(
    tasks,
    (next) => {
      const inspected = next.find((task) => task.id === inspectedTaskId.value);
      if (inspected && inspected.status !== "running") markSeen([inspected.id]);
    },
    { flush: "sync" },
  );

  function reset(): void {
    generation += 1;
    revisions.clear();
    tasksBySession.clear();
    seenBySession.clear();
    inspectedTaskId.value = null;
  }

  return {
    tasks,
    seenIds,
    runningCount,
    unseenFinishedIds,
    inspectedTaskId,
    inspect,
    connect,
    disconnect,
    handleEvent,
    load,
    markSeen,
    markAllFinishedSeen,
    stop,
    stopAll,
    rerun,
    readOutput,
    reset,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(useBackgroundTasksStore, import.meta.hot),
  );
}
