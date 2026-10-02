import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
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

  it("renders progress, node statuses, and the active form", () => {
    const wrapper = mountPanel({
      tasks: [
        { id: 1, subject: "Research", status: "completed" },
        {
          id: 2,
          subject: "Build",
          status: "in_progress",
          activeForm: "building the panel",
        },
        pending(3),
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
    const nodes = wrapper.findAll('[data-testid="project-todo-node"]');
    expect(nodes.map((node) => node.attributes("data-status"))).toEqual([
      "completed",
      "in_progress",
      "pending",
    ]);
  });

  it("draws edges only when a task depends on another", () => {
    const flat = mountPanel({ tasks: [pending(1), pending(2)], nextId: 3 });
    expect(flat.findAll('[data-testid="project-todo-edge"]')).toHaveLength(0);
    expect(flat.text()).toContain("#1");
    expect(flat.text()).toContain("#2");

    const linked = mountPanel({
      tasks: [
        { id: 1, subject: "Design", status: "completed" },
        pending(2, { blockedBy: [1] }),
        pending(3, { blockedBy: [1] }),
        pending(4, { blockedBy: [2, 3] }),
      ],
      nextId: 5,
    });
    const edges = linked.findAll('[data-testid="project-todo-edge"]');
    expect(edges).toHaveLength(4);
    // Only edges from the completed dependency no longer block anything.
    expect(edges.map((edge) => edge.attributes("data-satisfied"))).toEqual([
      "true",
      "true",
      "false",
      "false",
    ]);
    const lanes = linked
      .findAll('[data-testid="project-todo-node"]')
      .map((node) => node.attributes("data-lane"));
    expect(new Set(lanes).size).toBe(2);
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

  it("opens every task from the details button below the list", async () => {
    const wrapper = mountPanel({ tasks: [pending(1)], nextId: 2 });
    const details = wrapper.get('[data-testid="project-todo-details"]');
    expect(details.text()).toBe("查看详情…");
    expect(document.body.textContent).not.toContain("全部任务");

    await details.trigger("click");
    await flushPromises();

    expect(document.body.textContent).toContain("全部任务");
  });
});
