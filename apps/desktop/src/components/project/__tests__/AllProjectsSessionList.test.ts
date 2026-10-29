import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { h } from "vue";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  SESSION_HISTORY_STORAGE_KEY,
  useSessionHistoryStore,
} from "@/stores/sessionHistory";
import { useSessionStore } from "@/stores/session";
import { createAppI18n } from "@/app/i18n";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import SessionGroupDialog from "@/components/sessions/SessionGroupDialog.vue";
import { SESSION_DRAG_TYPE } from "@/lib/sessionDrag";
import AllProjectsSessionList from "../AllProjectsSessionList.vue";

function project(id: string, name: string): PineProject {
  return {
    createdAt: "2026-08-24T00:00:00.000Z",
    defaultFolderId: "folder",
    folders: [],
    id,
    name,
    schemaVersion: 1,
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

const pine = project("9ab0b15f-331f-4aa6-8056-cd2be3bf7414", "Pine");
const noProject = project(TEMPORARY_WORKSPACE_PROJECT_ID, "Temporary");

const sessions: ProjectSessionSearchResult[] = [
  {
    createdAt: "2026-10-05T00:00:00.000Z",
    id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
    messageCount: 2,
    name: "Fix the tab bar",
    projectId: pine.id,
    updatedAt: "2026-10-05T00:01:00.000Z",
  },
  {
    createdAt: "2026-10-04T00:00:00.000Z",
    id: "019cfe51-7166-79b9-a5b9-c652fcca9eac",
    messageCount: 2,
    preview: "Plan a trip",
    projectId: noProject.id,
    updatedAt: "2026-10-04T00:01:00.000Z",
  },
];

beforeEach(() => {
  localStorage.clear();
});

async function mountList(
  options: {
    projects?: PineProject[];
    sessions?: ProjectSessionSearchResult[];
  } = {},
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/");
  const updateProjectSessionGroups = vi.fn(
    ({ id, sessionGroups }: { id: string; sessionGroups: unknown[] }) =>
      Promise.resolve({
        project: {
          ...(options.projects ?? [noProject, pine]).find(
            (candidate) => candidate.id === id,
          )!,
          sessionGroups,
        },
      }),
  );
  const openProject = vi.fn(({ id }: { id: string }) =>
    Promise.resolve({
      opened: true,
      project: (options.projects ?? [noProject, pine]).find(
        (candidate) => candidate.id === id,
      )!,
    }),
  );
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      listAllRecentSessions: vi
        .fn()
        .mockResolvedValue({ sessions: options.sessions ?? sessions }),
      openProject,
      updateProjectSessionGroups,
    },
  });
  const projectStore = useProjectStore();
  projectStore.projects = options.projects ?? [noProject, pine];
  projectStore.openProjectIds = new Set([noProject.id]);
  projectStore.setCurrentProject(noProject.id);
  const wrapper = mount(SidebarProvider, {
    slots: { default: () => h(AllProjectsSessionList) },
    global: { plugins: [pinia, router, createAppI18n("zh-CN")] },
  });
  await flushPromises();
  return { router, wrapper, openProject, updateProjectSessionGroups };
}

describe("AllProjectsSessionList", () => {
  it("places project management below New session and opens it on click", async () => {
    const { wrapper } = await mountList();
    const actions = wrapper
      .findAll('[data-slot="sidebar-menu"]')[0]
      .findAll("button");
    expect(actions.map((button) => button.text())).toEqual([
      "搜索会话",
      "新会话",
      "项目管理",
    ]);
    await actions[2].trigger("click");
    expect(
      wrapper.findComponent(AllProjectsSessionList).emitted("manageProjects"),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it("nests sessions under their project and keeps empty projects", async () => {
    const empty = project("empty", "Empty project");
    const { wrapper } = await mountList({ projects: [noProject, pine, empty] });
    const toggles = wrapper.findAll("[data-project-toggle]");
    expect(toggles.map((row) => row.text())).toEqual([
      "无项目",
      "Pine",
      "Empty project",
    ]);
    const pineGroup = wrapper
      .get(`[data-project-toggle="${pine.id}"]`)
      .element.closest("li")!;
    expect(pineGroup.textContent).toContain("Fix the tab bar");
    expect(pineGroup.textContent).not.toContain("Plan a trip");
    expect(wrapper.findAll("[data-session-id]")).toHaveLength(2);
    expect(wrapper.find('[data-slot="session-project"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("还没有会话");
    expect(wrapper.text()).not.toContain("更久以前");
    wrapper.unmount();
  });

  it("collapses projects independently and remembers them", async () => {
    const { wrapper } = await mountList();
    const toggle = wrapper.get(`[data-project-toggle="${pine.id}"]`);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    await flushPromises();
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(`[data-session-id="${sessions[0].id}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.find(`[data-session-id="${sessions[1].id}"]`).exists()).toBe(
      true,
    );
    expect(
      JSON.parse(localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)!),
    ).toEqual([pine.id]);
    wrapper.unmount();
    const remounted = await mountList();
    expect(
      remounted.wrapper
        .get(`[data-project-toggle="${pine.id}"]`)
        .attributes("aria-expanded"),
    ).toBe("false");
    remounted.wrapper.unmount();
  });

  it("shows five recent sessions per project, then reveals more independently", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...sessions[0],
      id: `session-${index}`,
      name: `Conversation ${index}`,
    }));
    const { wrapper } = await mountList({ sessions: [...many, sessions[1]] });
    expect(wrapper.findAll(`[data-project-id="${pine.id}"]`)).toHaveLength(5);
    await wrapper.get(`[data-project-show-more="${pine.id}"]`).trigger("click");
    expect(wrapper.findAll(`[data-project-id="${pine.id}"]`)).toHaveLength(10);
    expect(wrapper.findAll(`[data-project-id="${noProject.id}"]`)).toHaveLength(
      1,
    );
    await wrapper.get(`[data-project-show-more="${pine.id}"]`).trigger("click");
    expect(wrapper.findAll(`[data-project-id="${pine.id}"]`)).toHaveLength(12);
    expect(wrapper.find("[data-project-show-more]").exists()).toBe(false);

    const toggle = wrapper.get(`[data-project-toggle="${pine.id}"]`);
    await toggle.trigger("click");
    await flushPromises();
    await toggle.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(`[data-project-id="${pine.id}"]`)).toHaveLength(5);
    expect(wrapper.findAll(`[data-project-id="${noProject.id}"]`)).toHaveLength(
      1,
    );
    await wrapper.get(`[data-project-show-more="${pine.id}"]`).trigger("click");
    expect(wrapper.findAll(`[data-project-id="${pine.id}"]`)).toHaveLength(10);
    wrapper.unmount();
  });

  it("reveals an older active session when returning through a tab", async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...sessions[0],
      id: `session-${index}`,
    }));
    const { wrapper, router } = await mountList({ sessions: many });
    useSessionHistoryStore().setOpen(pine.id, false);
    const tab = useContentTabsStore().openSession(many[7], pine.id);
    await router.push({ query: { tab: tab.id } });
    await flushPromises();
    const selected = wrapper.get('[data-session-id="session-7"]');
    expect(selected.attributes("data-active")).toBe("true");
    expect(wrapper.findAll("[data-session-id]")).toHaveLength(6);
    wrapper.unmount();
  });

  it("creates a draft in the chosen project without toggling it", async () => {
    const { wrapper } = await mountList();
    useSessionHistoryStore().setOpen(pine.id, false);
    await wrapper
      .get(`[data-project-new-session="${pine.id}"]`)
      .trigger("click");
    await flushPromises();
    const tab = useContentTabsStore().tabs.find(
      (candidate) =>
        candidate.kind === "session" && candidate.projectId === pine.id,
    );
    expect(tab).toMatchObject({ state: "draft", projectId: pine.id });
    wrapper.unmount();
  });

  it("updates grouped history after sessions change or a project is removed", async () => {
    const { wrapper } = await mountList();
    useSessionStore().allRecentSessions = [sessions[1]];
    await flushPromises();
    expect(wrapper.find(`[data-session-id="${sessions[0].id}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.find(`[data-project-toggle="${pine.id}"]`).exists()).toBe(
      true,
    );
    useProjectStore().projects = [noProject];
    await flushPromises();
    expect(wrapper.find(`[data-project-toggle="${pine.id}"]`).exists()).toBe(
      false,
    );
    expect(wrapper.findAll("[data-session-id]")).toHaveLength(1);
    wrapper.unmount();
  });

  it("opens a session in its own project", async () => {
    const { router, wrapper, openProject } = await mountList();
    await wrapper.get(`[data-session-id="${sessions[0].id}"]`).trigger("click");
    await flushPromises();
    expect(openProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: pine.id }),
    );
    const tab = useContentTabsStore().tabs.find(
      (candidate) =>
        candidate.kind === "session" &&
        candidate.state === "bound" &&
        candidate.sessionId === sessions[0].id,
    );
    expect(tab?.projectId).toBe(pine.id);
    expect(router.currentRoute.value.query.tab).toBe(tab?.id);
    wrapper.unmount();
  });

  it("nests a project's folders above its loose sessions", async () => {
    const filed = { ...sessions[0], id: "filed", name: "Filed away" };
    const pineWithFolder = {
      ...pine,
      sessionGroups: [
        { id: "folder-1", name: "Research", sessionIds: [filed.id] },
        { id: "folder-2", name: "Empty", sessionIds: [] },
      ],
    };
    const { wrapper } = await mountList({
      projects: [noProject, pineWithFolder],
      sessions: [filed, ...sessions],
    });
    const folder = wrapper
      .get('[data-session-group-id="folder-1"]')
      .element.closest("li")!;
    expect(folder.textContent).toContain("Research");
    expect(folder.querySelector('[data-session-id="filed"]')).not.toBeNull();
    const projectRow = wrapper
      .get(`[data-project-toggle="${pine.id}"]`)
      .element.closest("li")!;
    const rows = Array.from(
      projectRow.querySelectorAll(
        "[data-session-group-toggle], [data-session-id]",
      ),
    ).map((row) => row.textContent?.trim());
    expect(rows).toEqual([
      "Research",
      "Filed away",
      "Empty",
      "Fix the tab bar",
    ]);
    expect(wrapper.text()).toContain("该文件夹暂无会话");

    await wrapper
      .get('[data-session-group-toggle="folder-1"]')
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-session-id="filed"]').exists()).toBe(false);
    expect(useSessionHistoryStore().isOpen("folder-1")).toBe(false);
    wrapper.unmount();
  });

  it("creates a folder from the button beside New session", async () => {
    const { wrapper, updateProjectSessionGroups } = await mountList();
    const projectRow = wrapper
      .get(`[data-project-toggle="${pine.id}"]`)
      .element.closest("li")!;
    const actions = Array.from(
      projectRow.querySelectorAll(":scope > [data-sidebar=menu-action]"),
    );
    expect(actions.map((action) => action.getAttribute("aria-label"))).toEqual([
      "在Pine中新建文件夹",
      "在Pine中新建会话",
    ]);
    await wrapper.get(`[data-project-new-group="${pine.id}"]`).trigger("click");
    const dialog = wrapper.getComponent(SessionGroupDialog);
    expect(dialog.props("open")).toBe(true);
    dialog.vm.$emit("submit", "Research");
    await flushPromises();
    expect(updateProjectSessionGroups).toHaveBeenCalledWith({
      id: pine.id,
      sessionGroups: [
        { id: expect.any(String), name: "Research", sessionIds: [] },
      ],
    });
    expect(wrapper.text()).toContain("Research");
    wrapper.unmount();
  });

  it("files a dragged session into a folder of its own project", async () => {
    const pineWithFolder = {
      ...pine,
      sessionGroups: [{ id: "folder-1", name: "Research", sessionIds: [] }],
    };
    const { wrapper, updateProjectSessionGroups } = await mountList({
      projects: [noProject, pineWithFolder],
    });
    const data = new Map<string, string>();
    const dataTransfer = {
      types: [SESSION_DRAG_TYPE],
      dropEffect: "none",
      effectAllowed: "all",
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };
    const folder = wrapper.get('[data-session-group-id="folder-1"]');

    // A session of another project stays where it is.
    await wrapper
      .get(`[data-session-id="${sessions[1].id}"]`)
      .trigger("dragstart", { dataTransfer });
    await folder.trigger("drop", { dataTransfer });
    expect(updateProjectSessionGroups).not.toHaveBeenCalled();

    await wrapper
      .get(`[data-session-id="${sessions[0].id}"]`)
      .trigger("dragstart", { dataTransfer });
    await folder.trigger("dragover", { dataTransfer });
    expect(
      wrapper.get('[data-session-group-toggle="folder-1"]').classes(),
    ).toContain("ring-1");
    await folder.trigger("drop", { dataTransfer });
    await flushPromises();
    expect(updateProjectSessionGroups).toHaveBeenCalledWith({
      id: pine.id,
      sessionGroups: [
        { id: "folder-1", name: "Research", sessionIds: [sessions[0].id] },
      ],
    });
    expect(
      folder.element.querySelector(`[data-session-id="${sessions[0].id}"]`),
    ).not.toBeNull();
    wrapper.unmount();
  });

  it("opens the folder of an active session reached through a tab", async () => {
    const pineWithFolder = {
      ...pine,
      sessionGroups: [
        { id: "folder-1", name: "Research", sessionIds: [sessions[0].id] },
      ],
    };
    const { wrapper, router } = await mountList({
      projects: [noProject, pineWithFolder],
    });
    useSessionHistoryStore().setOpen("folder-1", false);
    await flushPromises();
    expect(wrapper.find(`[data-session-id="${sessions[0].id}"]`).exists()).toBe(
      false,
    );
    const tab = useContentTabsStore().openSession(sessions[0], pine.id);
    await router.push({ query: { tab: tab.id } });
    await flushPromises();
    expect(
      wrapper
        .get(`[data-session-id="${sessions[0].id}"]`)
        .attributes("data-active"),
    ).toBe("true");
    wrapper.unmount();
  });
});
