import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import type { SetupContext } from "vue";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ROUTE_NAMES } from "@/router/routes";
import {
  TEMPORARY_WORKSPACE_FOLDER_ID,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import { useProjectStore } from "@/stores/project";
import {
  PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY,
  useProjectSidebarVisibilityStore,
} from "@/stores/projectSidebarVisibility";
import ProjectView from "../ProjectView.vue";
import { showProject } from "@/stores/__tests__/showProject";

const openPreferences = vi.fn();

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
          setup(_props: unknown, { expose }: SetupContext) {
            expose({ open: openPreferences });
          },
          template: '<button data-pine-preferences type="button" />',
        },
        ProjectContentTabs: { template: "<div />" },
        ProjectSidebar: {
          emits: ["manageProjects"],
          template:
            '<div><button type="button" data-manage-projects @click="$emit(\'manageProjects\')" /></div>',
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

it.each([project.id, TEMPORARY_WORKSPACE_PROJECT_ID])(
  "opens project management in preferences from project %s",
  async (projectId) => {
    openPreferences.mockClear();
    const { projectStore, wrapper } = await mountView();
    projectStore.setCurrentProject(projectId);
    await wrapper.get("[data-manage-projects]").trigger("click");
    expect(openPreferences).toHaveBeenCalledExactlyOnceWith("projects");
    wrapper.unmount();
  },
);

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

it("opens the workbench beside the conversation and widens the window for it", async () => {
  const planWindowResize = vi.fn().mockResolvedValue(0);
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "darwin",
    { planWindowResize },
  );
  await flushPromises();
  const toggle = wrapper.get('[data-testid="project-workbench-toggle"]');
  const workbenchSidebar = () =>
    wrapper
      .get('[data-testid="project-workbench-provider"] [data-slot="sidebar"]')
      .attributes("data-state");

  expect(toggle.attributes("aria-pressed")).toBe("false");
  expect(workbenchSidebar()).toBe("collapsed");

  await toggle.trigger("click");
  await flushPromises();

  expect(planWindowResize).toHaveBeenLastCalledWith({
    kind: "set-workbench",
    open: true,
    width: 400,
  });
  expect(toggle.attributes("aria-pressed")).toBe("true");
  expect(workbenchSidebar()).toBe("expanded");
  expect(
    wrapper
      .get<HTMLElement>('[data-testid="project-workbench-provider"]')
      .element.style.getPropertyValue("--sidebar-width"),
  ).toBe("400px");

  // The left sidebar's shortcut leaves the workbench alone.
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "b", metaKey: true }),
  );
  await flushPromises();
  expect(workbenchSidebar()).toBe("expanded");
  wrapper.unmount();
});

it("follows the agent's workbench commands for the active session", async () => {
  const listeners: ((event: unknown) => void)[] = [];
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "darwin",
    {
      onSessionEvent: vi.fn((listener: (event: unknown) => void) => {
        listeners.push(listener);
        return () => undefined;
      }),
    },
  );
  await flushPromises();

  for (const listener of listeners)
    listener({
      type: "workbench-command",
      sessionId: "draft",
      toolCallId: "call-1",
      command: { kind: "open", panel: "preview" },
    });
  await flushPromises();

  expect(
    wrapper
      .get('[data-testid="project-workbench-toggle"]')
      .attributes("aria-pressed"),
  ).toBe("true");
  expect(
    wrapper
      .findAll('[data-testid="workbench-card"]')
      .map((card) => card.attributes("data-panel")),
  ).toEqual(["artifacts", "preview"]);
  wrapper.unmount();
});

it.each([
  [null, true],
  ["false", false],
])(
  "unlocks the project layout and fits the remembered sidebar (%s)",
  async (stored, open) => {
    if (stored)
      window.localStorage.setItem(
        PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY,
        stored,
      );
    const setWindowLayout = vi.fn().mockResolvedValue(undefined);
    const planWindowResize = vi.fn().mockResolvedValue(0);
    const { wrapper } = await mountView(
      vi.fn().mockResolvedValue(undefined),
      "darwin",
      { setWindowLayout, planWindowResize },
    );
    await flushPromises();

    expect(setWindowLayout).toHaveBeenCalledExactlyOnceWith("project");
    expect(planWindowResize.mock.calls).toEqual([
      [{ kind: "fit-sidebar", open }],
      [{ kind: "set-workbench", open: false, width: 400 }],
    ]);
    expect(useProjectSidebarVisibilityStore().open).toBe(open);
    wrapper.unmount();
  },
);

it("toggles the sidebar with the shortcut and remembers it", async () => {
  const planWindowResize = vi.fn().mockResolvedValue(0);
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "darwin",
    { planWindowResize },
  );
  await flushPromises();
  const left = () =>
    useProjectSidebarVisibilityStore().open ? "expanded" : "collapsed";

  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "b", metaKey: true }),
  );
  await flushPromises();

  expect(planWindowResize).toHaveBeenLastCalledWith({
    kind: "toggle-sidebar",
    open: false,
  });
  expect(left()).toBe("collapsed");
  expect(
    window.localStorage.getItem(PROJECT_SIDEBAR_VISIBILITY_STORAGE_KEY),
  ).toBe("false");
  wrapper.unmount();
});

it("slides the closing sidebar on the window's timeline with a fixed-width content area", async () => {
  let finishResize = () => {};
  const commitWindowResize = vi.fn(
    () => new Promise<void>((resolve) => (finishResize = resolve)),
  );
  const planWindowResize = vi
    .fn()
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(0)
    .mockResolvedValueOnce(-256);
  const { wrapper } = await mountView(
    vi.fn().mockResolvedValue(undefined),
    "darwin",
    { planWindowResize, commitWindowResize },
  );
  await flushPromises();
  const root = () => wrapper.get<HTMLElement>('[data-slot="sidebar-wrapper"]');
  const inset = () => wrapper.get<HTMLElement>('[data-slot="sidebar-inset"]');
  const trailing = () =>
    wrapper.get<HTMLElement>('[data-testid="project-trailing-controls"]');
  const workbenchColumn = () =>
    wrapper.get<HTMLElement>('[data-testid="project-workbench-provider"]');
  const visibility = useProjectSidebarVisibilityStore();

  await wrapper.get('[data-sidebar="trigger"]').trigger("click");
  await vi.waitFor(() => expect(commitWindowResize).toHaveBeenCalledOnce());

  expect(planWindowResize).toHaveBeenLastCalledWith({
    kind: "toggle-sidebar",
    open: false,
  });
  expect(root().element.style.width).toBe(`${window.innerWidth}px`);
  expect(root().element.style.contain).toBe("layout");
  expect(inset().element.style.flexGrow).toBe("0");
  await vi.waitFor(() => expect(visibility.open).toBe(false));
  expect(trailing().element.style.transform).toBe("translateX(-256px)");
  // The workbench column rides the narrowing window edge too.
  expect(
    workbenchColumn().element.style.getPropertyValue("--window-edge-shift"),
  ).toBe("-256px");
  expect(workbenchColumn().classes()).toContain(
    "[&_[data-slot=sidebar-container]]:translate-x-(--window-edge-shift)",
  );

  finishResize();
  await vi.waitFor(() => expect(root().element.style.width).toBe(""));
  expect(inset().element.style.flexGrow).toBe("");
  expect(trailing().element.style.transform).toBe("");
  expect(workbenchColumn().classes()).not.toContain(
    "[&_[data-slot=sidebar-container]]:translate-x-(--window-edge-shift)",
  );
  wrapper.unmount();
});
