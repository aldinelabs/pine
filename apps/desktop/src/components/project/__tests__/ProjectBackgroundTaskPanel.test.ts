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
      wrapper
        .get(
          '[data-testid="project-background-task-placeholder"] [data-testid="project-sidebar-empty-label"]',
        )
        .text(),
    ).toBe("暂无后台进程");
  });

  it("shows process icons, names and durations in a single row", () => {
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
    expect(wrapper.text()).not.toContain("失败");
    const button = wrapper.get(
      '[data-testid="project-background-task-row"] [data-sidebar="menu-button"]',
    );
    expect(button.attributes("aria-label")).toBe("Build: 运行中");
    expect(button.find(".text-sm").text()).toBe("Build");
    expect(button.find(".tabular-nums").classes()).toContain("ml-auto");
  });

  it("opens process details", async () => {
    const wrapper = mountPanel([{ ...running, status: "completed" }]);
    await wrapper
      .get(
        '[data-testid="project-background-task-row"] [data-sidebar="menu-button"]',
      )
      .trigger("click");
    expect(useBackgroundTasksStore().inspectedTaskId).toBe(running.id);
  });

  it("stops a running process and offers no action for finished processes", async () => {
    const wrapper = mountPanel([
      running,
      { ...running, id: "finished", status: "completed" },
    ]);
    expect(wrapper.findAll('[data-sidebar="menu-action"]')).toHaveLength(1);
    await wrapper
      .get('[data-testid="project-background-task-stop"]')
      .trigger("click");
    await flushPromises();
    expect(window.pine.stopBackgroundTask).toHaveBeenCalledWith({
      sessionId,
      taskId: running.id,
    });
  });
});
