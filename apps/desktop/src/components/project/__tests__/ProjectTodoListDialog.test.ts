import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { afterEach, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectTodoListDialog from "../ProjectTodoListDialog.vue";
import ProjectTodoGraph from "../ProjectTodoGraph.vue";

const passthrough = defineComponent(
  (_props, { slots }) =>
    () =>
      h("div", slots.default?.()),
);
const wrappers: ReturnType<typeof mount>[] = [];
function mountDialog() {
  const wrapper = mount(ProjectTodoListDialog, {
    props: {
      open: true,
      isRunning: true,
      todos: {
        nextId: 5,
        tasks: [
          {
            id: 1,
            subject: "Finished",
            description: "Full finished details",
            status: "completed",
          },
          {
            id: 2,
            subject: "Pending ".repeat(50),
            description: "Full pending description\nSecond line",
            status: "pending",
            blockedBy: [1],
          },
          {
            id: 3,
            subject: "Active",
            activeForm: "Checking layout",
            description: "Full active description",
            status: "in_progress",
            blockedBy: [2],
          },
          { id: 4, subject: "Deleted", status: "deleted" },
        ],
      },
    },
    global: {
      plugins: [createAppI18n("en-US")],
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
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("keeps the header outside a bounded list scroller", () => {
  const wrapper = mountDialog();
  const dialog = wrapper.get("[data-testid=project-todo-list-dialog]");
  expect(dialog.classes()).toContain("overflow-hidden");
  expect(dialog.classes()).toContain("max-h-[85dvh]");
  const scroll = wrapper.get("[data-testid=project-todo-list-scroll]");
  expect(scroll.classes()).toContain("min-h-0");
  expect(scroll.attributes("data-slot")).toBe("dialog-scroll-area");
  expect(
    scroll
      .get('[data-slot="scroll-area-viewport"]')
      .attributes("data-reka-scroll-area-viewport"),
  ).toBeDefined();
  expect(scroll.find("[data-slot=dialog-header]").exists()).toBe(false);
});

it("shows the compact card's graph with full subjects and descriptions, without status groups", () => {
  const wrapper = mountDialog();
  expect(wrapper.getComponent(ProjectTodoGraph).props("detailed")).toBe(true);
  expect(wrapper.findAll("[data-testid=project-todo-node]")).toHaveLength(3);
  expect(wrapper.findAll("[data-testid=project-todo-edge]")).toHaveLength(2);
  const rows = wrapper.findAll("[data-testid=project-todo-row]");
  expect(rows.map((row) => row.attributes("data-task-id"))).toEqual([
    "1",
    "2",
    "3",
  ]);
  expect(wrapper.text()).toContain("Full finished details");
  expect(wrapper.text()).toContain("Full pending description");
  expect(wrapper.text()).toContain("Full active description");
  expect(wrapper.find(".truncate").exists()).toBe(false);
  expect(wrapper.find("[data-testid^=project-todo-section-]").exists()).toBe(
    false,
  );
});

it("aligns graph nodes to measured multiline row heights", async () => {
  const wrapper = mountDialog();
  const rows = wrapper.findAll<HTMLElement>("[data-testid=project-todo-row]");
  rows.forEach((row, index) =>
    Object.defineProperty(row.element, "offsetHeight", {
      configurable: true,
      value: [100, 140, 80][index],
    }),
  );
  // A content update schedules the same measurement as a width/height resize.
  await wrapper.setProps({
    todos: {
      ...wrapper.props("todos")!,
      tasks: [...wrapper.props("todos")!.tasks],
    },
  });
  await nextTick();
  const nodes = wrapper.findAll("[data-testid=project-todo-node]");
  expect(
    nodes.map((node) => node.attributes("cy") ?? node.attributes("transform")),
  ).toEqual(["24", "124", "translate(8 264)"]);
  expect(
    wrapper.get("[data-testid=project-todo-graph]").attributes("height"),
  ).toBe("320");
});
