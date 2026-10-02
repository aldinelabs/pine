import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTaskSnapshot } from "@pine/pi-background-tasks";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import ProjectBackgroundTaskPanel from "../ProjectBackgroundTaskPanel.vue";

const sessionId = "session-a";
const running: BackgroundTaskSnapshot = {
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
function mountPanel(tasks: BackgroundTaskSnapshot[] = []) {
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
    tasks,
  });
  const Host = defineComponent(
    () => () =>
      h(TooltipProvider, () =>
        h(SidebarProvider, () => h(ProjectBackgroundTaskPanel)),
      ),
  );
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: { ProjectBackgroundTaskDialog: true },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("ProjectBackgroundTaskPanel", () => {
  beforeEach(() => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        platform: "darwin",
        stopBackgroundTask: vi
          .fn()
          .mockResolvedValue({ task: { ...running, status: "killed" } }),
        stopAllBackgroundTasks: vi
          .fn()
          .mockResolvedValue({ stopped: 2, failures: [] }),
        rerunBackgroundTask: vi.fn().mockResolvedValue({ task: running }),
      },
    });
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";
  });

  it("keeps an empty module in the sidebar", () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("后台进程");
    expect(
      wrapper.get('[data-testid="project-background-task-placeholder"]').text(),
    ).toBe("暂无后台进程");
  });

  it("shows statuses, running count and unseen completions", () => {
    const wrapper = mountPanel([
      running,
      { ...running, id: "failed", status: "failed", name: "Tests" },
    ]);
    expect(
      wrapper
        .findAll('[data-testid="project-background-task-row"]')
        .map((row) => row.attributes("data-status")),
    ).toEqual(["running", "failed"]);
    expect(wrapper.text()).toContain("1 个运行中");
    expect(wrapper.find('[aria-label="未读"]').exists()).toBe(true);
  });

  it("opens task details and acknowledges finished notices", async () => {
    const wrapper = mountPanel([{ ...running, status: "completed" }]);
    await wrapper
      .get(
        '[data-testid="project-background-task-row"] [data-sidebar="menu-button"]',
      )
      .trigger("click");
    expect(useBackgroundTasksStore().inspectedTaskId).toBe(running.id);
    expect(wrapper.find('[aria-label="未读"]').exists()).toBe(false);
  });

  it("stops and reruns the selected task", async () => {
    const wrapper = mountPanel([
      running,
      { ...running, id: "finished", status: "completed" },
    ]);
    await wrapper
      .get('[data-testid="project-background-task-stop"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="project-background-task-rerun"]')
      .trigger("click");
    await flushPromises();
    expect(window.pine.stopBackgroundTask).toHaveBeenCalledWith({
      sessionId,
      taskId: running.id,
    });
    expect(window.pine.rerunBackgroundTask).toHaveBeenCalledWith({
      sessionId,
      taskId: "finished",
    });
  });

  it("stops all running tasks and clears unread notices", async () => {
    const wrapper = mountPanel([
      running,
      { ...running, id: "second" },
      { ...running, id: "done", status: "completed" },
    ]);
    await wrapper
      .get('[data-testid="project-background-task-stop-all"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="project-background-task-mark-read"]')
      .trigger("click");
    await flushPromises();
    expect(window.pine.stopAllBackgroundTasks).toHaveBeenCalledWith({
      sessionId,
    });
    expect(useBackgroundTasksStore().unseenFinishedIds.size).toBe(0);
  });
});
