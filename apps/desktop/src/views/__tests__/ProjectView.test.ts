import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ROUTE_NAMES } from "@/router/routes";
import type { PineProject } from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import ProjectView from "../ProjectView.vue";

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "pine",
      path: "/projects/pine",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};

beforeEach(() => {
  window.localStorage.clear();
});

async function mountView(
  closeProject = vi.fn().mockResolvedValue(undefined),
  platform: "darwin" | "win32" = "darwin",
) {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: { closeProject, platform },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectStore = useProjectStore();
  projectStore.activeProject = project;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/projects",
        name: ROUTE_NAMES.projects,
        component: { template: "<div />" },
      },
      {
        path: "/projects/:projectId",
        name: ROUTE_NAMES.project,
        component: { template: "<div />" },
      },
    ],
  });
  await router.push({
    name: ROUTE_NAMES.project,
    params: { projectId: project.id },
  });
  const wrapper = mount(ProjectView, {
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: {
        PinePreferencesDialog: {
          template: '<button data-pine-preferences type="button" />',
        },
        ProjectContentTabs: { template: "<div />" },
        ProjectDialog: {
          props: ["open"],
          template: '<div data-project-dialog :data-open="String(open)" />',
        },
        ProjectSidebar: {
          emits: ["editProject"],
          template:
            '<button type="button" data-edit-project @click="$emit(\'editProject\')" />',
        },
        SessionSearchOverlay: { template: "<div />" },
        PineUpdateDialog: { template: "<div />" },
      },
    },
  });

  return { closeProject, projectStore, router, wrapper };
}

it("renders the home action beside the sidebar toggle", async () => {
  const { wrapper } = await mountView();
  const leading = wrapper.get('[data-slot="window-titlebar-leading"]');
  const home = leading.get('[aria-label="关闭项目"]');

  expect(
    wrapper.get('[data-slot="window-titlebar-sidebar-drag-region"]').classes(),
  ).toContain("window-drag");

  expect(leading.element.children).toHaveLength(2);
  expect(leading.element.firstElementChild?.getAttribute("data-slot")).toBe(
    "sidebar-trigger",
  );
  expect(home.attributes("title")).toBe("关闭项目");
  expect(home.text()).toBe("");
  wrapper.unmount();
});

it("still opens project settings from the sidebar", async () => {
  const { wrapper } = await mountView();
  expect(wrapper.get("[data-project-dialog]").attributes("data-open")).toBe(
    "false",
  );

  await wrapper.get("[data-edit-project]").trigger("click");

  expect(wrapper.get("[data-project-dialog]").attributes("data-open")).toBe(
    "true",
  );
  wrapper.unmount();
});

it("places the Windows logo and preferences before navigation controls", async () => {
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "win32",
  );
  const leading = wrapper.get('[data-slot="window-titlebar-leading"]');

  expect(leading.find('[data-testid="windows-titlebar-logo"]').exists()).toBe(
    true,
  );
  expect(leading.find("[data-pine-preferences]").exists()).toBe(true);
  expect(leading.element.firstElementChild?.getAttribute("data-slot")).toBe(
    "window-titlebar-logo-slot",
  );
  wrapper.unmount();
});

it("closes the active project and returns to the project list", async () => {
  const { closeProject, projectStore, router, wrapper } = await mountView();

  await wrapper.get('[aria-label="关闭项目"]').trigger("click");
  await flushPromises();

  expect(closeProject).toHaveBeenCalledTimes(1);
  expect(projectStore.activeProject).toBeNull();
  expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.projects);
  wrapper.unmount();
});

it("stays on the project when closing it fails", async () => {
  const { projectStore, router, wrapper } = await mountView(
    vi.fn().mockRejectedValue(new Error("close failed")),
  );

  await wrapper.get('[aria-label="关闭项目"]').trigger("click");
  await flushPromises();

  expect(projectStore.activeProject).toEqual(project);
  expect(router.currentRoute.value.name).toBe(ROUTE_NAMES.project);
  wrapper.unmount();
});

it("opens the right sidebar by default and toggles it independently of the left shortcut", async () => {
  const { wrapper } = await mountView();
  await flushPromises();
  const right = () =>
    wrapper.get('[data-slot="sidebar"][data-side="right"]').attributes();
  const toggle = wrapper.get('[data-testid="project-right-sidebar-toggle"]');

  expect(right()["data-state"]).toBe("expanded");
  expect(toggle.attributes("aria-pressed")).toBe("true");

  await toggle.trigger("click");
  await flushPromises();
  expect(right()["data-state"]).toBe("collapsed");
  expect(toggle.attributes("aria-pressed")).toBe("false");

  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "b", metaKey: true }),
  );
  await flushPromises();
  expect(right()["data-state"]).toBe("collapsed");
  wrapper.unmount();
});
