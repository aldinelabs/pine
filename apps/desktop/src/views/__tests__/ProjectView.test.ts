import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ROUTE_NAMES } from "@/router/routes";
import {
  TEMPORARY_WORKSPACE_FOLDER_ID,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import { PROJECT_RIGHT_SIDEBAR_STORAGE_KEY } from "@/stores/projectRightSidebar";
import ProjectView from "../ProjectView.vue";
import { showProject } from "@/stores/__tests__/showProject";

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

const temporaryWorkspace: PineProject = {
  ...project,
  defaultFolderId: TEMPORARY_WORKSPACE_FOLDER_ID,
  folders: [
    {
      access: "read-write",
      id: TEMPORARY_WORKSPACE_FOLDER_ID,
      isAvailable: true,
      name: "Temporary Workspace",
      path: "/pine/projects/temporary/workspace",
    },
  ],
  id: TEMPORARY_WORKSPACE_PROJECT_ID,
  name: "Temporary Workspace",
};

beforeEach(() => {
  window.localStorage.clear();
});

async function mountView(
  closeProject = vi.fn().mockResolvedValue(undefined),
  platform: "darwin" | "win32" = "darwin",
  windowApi: Record<string, unknown> = {},
) {
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      closeProject,
      listProjects: vi.fn().mockResolvedValue({
        projects: [temporaryWorkspace, project],
      }),
      onSessionEvent: vi.fn().mockReturnValue(() => undefined),
      platform,
      setWindowLayout: vi.fn().mockResolvedValue(undefined),
      planWindowResize: vi.fn().mockResolvedValue(0),
      commitWindowResize: vi.fn().mockResolvedValue(undefined),
      ...windowApi,
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectStore = useProjectStore();
  showProject(project);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        name: ROUTE_NAMES.workspace,
        component: { template: "<div />" },
      },
    ],
  });
  await router.push({ name: ROUTE_NAMES.workspace });
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

it("has no route back to a project list", async () => {
  const { wrapper } = await mountView();
  const leading = wrapper.get('[data-slot="window-titlebar-leading"]');

  expect(
    wrapper.get('[data-slot="window-titlebar-sidebar-drag-region"]').classes(),
  ).toContain("window-drag");
  expect(leading.element.children).toHaveLength(1);
  expect(leading.element.firstElementChild?.getAttribute("data-slot")).toBe(
    "sidebar-trigger",
  );
  expect(leading.find('[aria-label="关闭项目"]').exists()).toBe(false);
  wrapper.unmount();
});

it("does not offer settings for the temporary workspace", async () => {
  const { projectStore, wrapper } = await mountView();
  await flushPromises();
  projectStore.setCurrentProject(TEMPORARY_WORKSPACE_PROJECT_ID);
  await flushPromises();

  expect(wrapper.find("[data-project-dialog]").exists()).toBe(false);
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

it.each([
  [null, true],
  ["false", false],
])(
  "unlocks the project layout and fits the remembered right sidebar (%s)",
  async (stored, fits) => {
    if (stored)
      window.localStorage.setItem(PROJECT_RIGHT_SIDEBAR_STORAGE_KEY, stored);
    const setWindowLayout = vi.fn().mockResolvedValue(undefined);
    const planWindowResize = vi.fn().mockResolvedValue(0);
    const { wrapper } = await mountView(
      vi.fn().mockResolvedValue(undefined),
      "darwin",
      { setWindowLayout, planWindowResize },
    );
    await flushPromises();

    expect(setWindowLayout).toHaveBeenCalledExactlyOnceWith("project");
    expect(planWindowResize.mock.calls).toEqual(
      fits ? [[{ kind: "fit-right-sidebar" }]] : [],
    );
    wrapper.unmount();
  },
);

it("freezes the layout while the window clips the closing right sidebar", async () => {
  let finishResize = () => {};
  const commitWindowResize = vi.fn(
    () => new Promise<void>((resolve) => (finishResize = resolve)),
  );
  const planWindowResize = vi
    .fn()
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(-256);
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "darwin",
    { planWindowResize, commitWindowResize },
  );
  await flushPromises();
  const root = () => wrapper.get<HTMLElement>('[data-slot="sidebar-wrapper"]');
  const right = () =>
    wrapper
      .get('[data-slot="sidebar"][data-side="right"]')
      .attributes("data-state");

  await wrapper
    .get('[data-testid="project-right-sidebar-toggle"]')
    .trigger("click");
  await vi.waitFor(() => expect(commitWindowResize).toHaveBeenCalledOnce());

  expect(planWindowResize).toHaveBeenLastCalledWith({
    kind: "toggle-right-sidebar",
    open: false,
  });
  expect(root().element.style.width).toBe(`${window.innerWidth}px`);
  expect(root().element.style.contain).toBe("layout");
  expect(right()).toBe("expanded");
  const trailing = () =>
    wrapper.get<HTMLElement>('[data-testid="project-trailing-controls"]');
  await vi.waitFor(() =>
    expect(trailing().element.style.transform).toBe("translateX(-256px)"),
  );

  finishResize();
  await vi.waitFor(() => expect(right()).toBe("collapsed"));
  expect(root().element.style.width).toBe("");
  expect(trailing().element.style.transform).toBe("");
  wrapper.unmount();
});
