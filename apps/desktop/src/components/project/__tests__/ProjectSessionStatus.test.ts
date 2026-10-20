import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import type { Task, TaskState } from "@pine/rpiv-todo";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import { useSessionStore } from "@/stores/session";
import ProjectSessionStatus from "../ProjectSessionStatus.vue";

const sessionId = "session-a";
const wrappers: VueWrapper[] = [];

function task(id: number, status: Task["status"], extra: Partial<Task> = {}) {
  return { id, subject: `Task ${id}`, status, ...extra };
}

function process(
  id: string,
  status: BackgroundTaskSnapshot["status"],
  extra: Partial<BackgroundTaskSnapshot> = {},
): BackgroundTaskSnapshot {
  return {
    id,
    name: `Process ${id}`,
    command: "bun run build",
    status,
    cwd: "/project",
    outputPath: `/tmp/${id}.output`,
    startTime: 1_000,
    ...(status === "running" ? {} : { endTime: 2_000 }),
    bytesWritten: 0,
    notified: false,
    notifyOnCompletion: true,
    triggerOnCompletion: true,
    privileged: false,
    ...extra,
  };
}

function mountCard(
  todos: TaskState | null,
  processes: BackgroundTaskSnapshot[] = [],
  hidden: number[] = [],
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().activeSession = {
    id: sessionId,
    createdAt: "",
    updatedAt: "",
    messageCount: 0,
  };
  useBackgroundTasksStore().handleEvent({
    type: "background-tasks",
    sessionId,
    tasks: processes,
  });
  const wrapper = mount(ProjectSessionStatus, {
    props: { todos, hiddenCompletedIds: new Set(hidden), isRunning: true },
    global: {
      plugins: [pinia, createAppI18n("en-US")],
      stubs: { ProjectTodoListDialog: true, ProjectBackgroundTaskDialog: true },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

function todoRows(wrapper: VueWrapper) {
  return wrapper
    .findAll("[data-testid=project-todo-row]")
    .map((row) => [row.attributes("data-status"), row.get(".truncate").text()]);
}

beforeEach(() => {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      stopBackgroundTask: vi.fn().mockResolvedValue({
        task: process("p1", "killed"),
      }),
    },
  });
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
});

it("shows a short todo list in full, with the active form while in progress", () => {
  const wrapper = mountCard({
    nextId: 4,
    tasks: [
      task(1, "completed"),
      task(2, "in_progress", { activeForm: "Writing task 2" }),
      task(3, "pending"),
    ],
  });

  expect(todoRows(wrapper)).toEqual([
    ["completed", "Task 1"],
    ["in_progress", "Writing task 2"],
    ["pending", "Task 3"],
  ]);
  expect(
    wrapper.find("[data-testid=project-background-task-summary]").exists(),
  ).toBe(false);
});

it("lists every todo, whatever the card's height, so the graph stays whole", () => {
  const tasks = Array.from({ length: 8 }, (_, index) =>
    task(index + 1, index < 3 ? "completed" : "pending"),
  );
  const wrapper = mountCard({ nextId: 9, tasks });

  expect(todoRows(wrapper)).toHaveLength(8);
  expect(
    wrapper.get("[data-testid=project-todo-summary] .scroll-fade-y").classes(),
  ).toContain("overflow-y-auto");
});

it("draws dependencies between the visible todos", () => {
  const wrapper = mountCard({
    nextId: 4,
    tasks: [
      task(1, "completed"),
      task(2, "in_progress", { blockedBy: [1] }),
      task(3, "pending", { blockedBy: [2] }),
    ],
  });

  expect(
    wrapper
      .findAll("[data-testid=project-todo-edge]")
      .map((edge) => edge.attributes("data-satisfied")),
  ).toEqual(["true", "false"]);
});

it("hides when no todo is left to show and nothing runs in the background", () => {
  expect(
    mountCard(null).find("[data-testid=project-session-status]").exists(),
  ).toBe(false);
  expect(
    mountCard(
      { nextId: 3, tasks: [task(1, "completed"), task(2, "deleted")] },
      [],
      [1],
    )
      .find("[data-testid=project-session-status]")
      .exists(),
  ).toBe(false);
});

it("opens the full todo list", async () => {
  const wrapper = mountCard({ nextId: 2, tasks: [task(1, "pending")] });

  await wrapper.get("[data-testid=project-todo-summary]").trigger("click");

  expect(
    wrapper.findComponent({ name: "ProjectTodoListDialog" }).props("open"),
  ).toBe(true);
});

it("puts background processes beside the todos, running ones first", () => {
  const wrapper = mountCard({ nextId: 2, tasks: [task(1, "pending")] }, [
    process("p1", "completed", { endTime: 3_000 }),
    process("p2", "running"),
    process("p3", "failed", { endTime: 5_000 }),
    process("p4", "killed", { endTime: 4_000 }),
  ]);

  expect(
    wrapper
      .findAll("[data-testid=project-session-status] [data-slot=card]")
      .map((card) => card.attributes("data-testid")),
  ).toEqual(["project-todo-card", "project-background-task-card"]);
  expect(
    wrapper
      .findAll("[data-testid=project-background-task-row]")
      .map((row) => row.attributes("data-status")),
  ).toEqual(["running", "failed", "killed", "completed"]);
});

it("shows background processes alone once the todos are done", () => {
  const wrapper = mountCard(null, [process("p1", "running")]);

  expect(
    wrapper.find("[data-testid=project-background-task-card]").exists(),
  ).toBe(true);
  expect(wrapper.find("[data-testid=project-todo-summary]").exists()).toBe(
    false,
  );
});

it("opens a process's details and stops a running one", async () => {
  const wrapper = mountCard(null, [
    process("p1", "running"),
    process("p2", "completed"),
  ]);

  expect(
    wrapper.findAll("[data-testid=project-background-task-stop]"),
  ).toHaveLength(1);
  await wrapper
    .get("[data-testid=project-background-task-row] button")
    .trigger("click");
  expect(useBackgroundTasksStore().inspectedTaskId).toBe("p1");

  await wrapper
    .get("[data-testid=project-background-task-stop]")
    .trigger("click");
  await flushPromises();
  expect(window.pine.stopBackgroundTask).toHaveBeenCalledWith({
    sessionId,
    taskId: "p1",
  });
});
