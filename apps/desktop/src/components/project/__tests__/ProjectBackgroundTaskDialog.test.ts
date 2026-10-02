import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { createAppI18n } from "@/app/i18n";
import { useSessionStore } from "@/stores/session";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskDialog from "../ProjectBackgroundTaskDialog.vue";

const task: BackgroundTaskSnapshot = {
  id: "b1234abcd",
  name: "Build",
  command: "bun run build",
  status: "running",
  cwd: "/project",
  outputPath: "/tmp/build.output",
  startTime: Date.now(),
  bytesWritten: 0,
  notified: false,
  notifyOnCompletion: true,
  triggerOnCompletion: true,
  privileged: false,
};
const wrappers: ReturnType<typeof mount>[] = [];
const passthrough = defineComponent(
  (_props, { slots }) =>
    () =>
      h("div", slots.default?.()),
);
function mountDialog(tasks = [task]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().activeSession = {
    id: "session-a",
    createdAt: "",
    updatedAt: "",
    messageCount: 0,
  };
  useBackgroundTasksStore().handleEvent({
    type: "background-tasks",
    sessionId: "session-a",
    tasks,
  });
  const wrapper = mount(ProjectBackgroundTaskDialog, {
    props: { taskId: task.id, open: true },
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: {
        Dialog: passthrough,
        DialogContent: passthrough,
        DialogTitle: passthrough,
        DialogDescription: passthrough,
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}
function output(content: string) {
  return {
    content,
    bytesRead: content.length,
    totalBytes: content.length,
    truncated: false,
  };
}

describe("ProjectBackgroundTaskDialog", () => {
  beforeEach(() => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        readBackgroundTaskOutput: vi.fn().mockResolvedValue(output("compiled")),
      },
    });
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.useRealTimers();
  });

  it("shows command, permissions and output", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.text()).toContain("bun run build");
    expect(wrapper.text()).toContain("项目沙盒");
    expect(
      wrapper.get('[data-testid="project-background-task-output"]').text(),
    ).toBe("compiled");
  });

  it("polls live output and stops polling once the task ends", async () => {
    vi.useFakeTimers();
    mountDialog();
    await flushPromises();
    const initial = vi.mocked(window.pine.readBackgroundTaskOutput).mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(window.pine.readBackgroundTaskOutput).toHaveBeenCalledTimes(
      initial + 1,
    );
    useBackgroundTasksStore().handleEvent({
      type: "background-tasks",
      sessionId: "session-a",
      tasks: [{ ...task, status: "completed", endTime: Date.now() }],
    });
    await flushPromises();
    const final = vi.mocked(window.pine.readBackgroundTaskOutput).mock.calls
      .length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(window.pine.readBackgroundTaskOutput).toHaveBeenCalledTimes(final);
  });

  it("discards stale logs and errors when switching details", async () => {
    let rejectFirst!: (reason: Error) => void;
    vi.mocked(window.pine.readBackgroundTaskOutput)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(output("second task"));
    const wrapper = mountDialog([
      task,
      { ...task, id: "second", name: "Tests" },
    ]);
    await wrapper.setProps({ taskId: "second" });
    await flushPromises();
    rejectFirst(new Error("old task is gone"));
    await flushPromises();
    expect(
      wrapper.get('[data-testid="project-background-task-output"]').text(),
    ).toBe("second task");
  });

  it("keeps the newest output when responses finish out of order", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: ReturnType<typeof output>) => void;
    vi.mocked(window.pine.readBackgroundTaskOutput)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(output("newest"));
    const wrapper = mountDialog();
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    resolveFirst(output("older"));
    await flushPromises();
    expect(
      wrapper.get('[data-testid="project-background-task-output"]').text(),
    ).toBe("newest");
  });
});
