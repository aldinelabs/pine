import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task, TaskState } from "@pine/rpiv-todo";
import { createAppI18n } from "@/app/i18n";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session";
import ProjectTodoPanel from "../ProjectTodoPanel.vue";

function mountPanel(todos: TaskState | null, hidden: number[] = []) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useSessionStore();
  store.todos = todos;
  store.hiddenCompletedTodoIds = new Set(hidden);
  const Host = defineComponent(
    () => () =>
      h(TooltipProvider, () => h(SidebarProvider, () => h(ProjectTodoPanel))),
  );
  return mount(Host, {
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n("zh-CN")] },
  });
}

function pending(id: number, extra: Partial<Task> = {}): Task {
  return { id, subject: `Task ${id}`, status: "pending", ...extra };
}

describe("ProjectTodoPanel", () => {
  beforeEach(() => {
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { platform: "darwin" },
    });
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays hidden without visible tasks", () => {
    expect(
      mountPanel(null).find('[data-testid="project-todo-panel"]').exists(),
    ).toBe(false);
    const onlyFaded = mountPanel(
      {
        tasks: [
          { id: 1, subject: "Done", status: "completed" },
          { id: 2, subject: "Gone", status: "deleted" },
        ],
        nextId: 3,
      },
      [1],
    );
    expect(onlyFaded.find('[data-testid="project-todo-panel"]').exists()).toBe(
      false,
    );
  });

  it("renders progress, statuses, dependencies, and the active form", () => {
    const wrapper = mountPanel({
      tasks: [
        { id: 1, subject: "Research", status: "completed" },
        {
          id: 2,
          subject: "Build",
          status: "in_progress",
          activeForm: "building the panel",
        },
        pending(3, { blockedBy: [2] }),
        { id: 4, subject: "Dropped", status: "deleted" },
      ],
      nextId: 5,
    });

    expect(wrapper.text()).toContain("任务清单");
    expect(wrapper.text()).toContain("1/3");
    const rows = wrapper.findAll('[data-testid="project-todo-row"]');
    expect(rows.map((row) => row.attributes("data-status"))).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
    expect(rows[1]?.text()).toContain("building the panel");
    expect(rows[2]?.text()).toContain("#3");
    expect(rows[2]?.text()).toContain("依赖 #2");
  });

  it("omits ids when no task has dependencies", () => {
    const wrapper = mountPanel({ tasks: [pending(1)], nextId: 2 });
    expect(
      wrapper.find('[data-testid="project-todo-row"]').text(),
    ).not.toContain("#1");
  });

  it("fits the row budget and expands on demand", async () => {
    const wrapper = mountPanel({
      tasks: [
        { id: 1, subject: "Done 1", status: "completed" },
        { id: 2, subject: "Done 2", status: "completed" },
        ...Array.from({ length: 12 }, (_, index) => pending(index + 3)),
      ],
      nextId: 15,
    });

    const rows = () => wrapper.findAll('[data-testid="project-todo-row"]');
    const overflow = wrapper.get('[data-testid="project-todo-overflow"]');
    expect(rows()).toHaveLength(10);
    expect(
      rows().every((row) => row.attributes("data-status") === "pending"),
    ).toBe(true);
    expect(overflow.text()).toBe("另有 4 项（2 项已完成，2 项待处理）");

    await overflow.trigger("click");
    expect(rows()).toHaveLength(14);
    expect(overflow.text()).toBe("收起");
  });

  it("collapses with the keyboard shortcut and shows the expand hint", async () => {
    const wrapper = mountPanel({ tasks: [pending(1)], nextId: 2 });
    expect(
      wrapper.find('[data-testid="project-todo-expand-hint"]').exists(),
    ).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "T", metaKey: true, shiftKey: true }),
    );
    await nextTick();

    const hint = wrapper.get('[data-testid="project-todo-expand-hint"]');
    expect(hint.text()).toContain("展开");
    expect(hint.text()).toContain("⌘");
  });
});
