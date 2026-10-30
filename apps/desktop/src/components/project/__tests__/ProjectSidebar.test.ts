import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useProjectStore } from "@/stores/project";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import ProjectSidebar from "../ProjectSidebar.vue";
import { showProject } from "@/stores/__tests__/showProject";

const slot = { template: "<div><slot /></div>" };
const footerSlot = { template: "<footer><slot /></footer>" };
const buttonSlot = { template: "<button><slot /></button>" };

beforeEach(() => {
  localStorage.clear();
  window.pine = {
    getAppVersion: vi.fn().mockResolvedValue("0.1.0"),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
  } as unknown as typeof window.pine;
});

it("always lists every project's sessions, whichever project is current", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectStore = useProjectStore();
  showProject({
    id: "one",
    name: "One",
    createdAt: "",
    updatedAt: "",
    schemaVersion: 1,
    defaultFolderId: "folder",
    folders: [],
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/");
  const wrapper = mount(ProjectSidebar, {
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: {
        Sidebar: slot,
        SidebarContent: slot,
        SidebarFooter: footerSlot,
        SidebarMenu: slot,
        SidebarMenuButton: slot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        AllProjectsSessionList: { template: "<div data-all-sessions />" },
      },
    },
  });
  await flushPromises();
  const sessions = wrapper.get("[data-all-sessions]").element;
  expect(wrapper.find('[role="tab"]').exists()).toBe(false);
  expect(wrapper.text()).not.toContain("项目设置");

  showProject({ ...projectStore.activeProject!, id: "two" });
  await flushPromises();
  // Switching projects keeps the same list rather than swapping it.
  expect(wrapper.findAll("[data-all-sessions]")).toHaveLength(1);
  expect(wrapper.get("[data-all-sessions]").element).toBe(sessions);
  wrapper.unmount();
});

it.each([TEMPORARY_WORKSPACE_PROJECT_ID, "project-one"])(
  "forwards project management from the session list for project %s",
  async (projectId) => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useProjectStore().setCurrentProject(projectId);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    const wrapper = mount(ProjectSidebar, {
      global: {
        plugins: [pinia, router, createAppI18n("zh-CN")],
        stubs: {
          Sidebar: slot,
          SidebarContent: slot,
          SidebarFooter: footerSlot,
          SidebarMenu: slot,
          SidebarMenuButton: buttonSlot,
          SidebarMenuItem: slot,
          SidebarRail: true,
          AllProjectsSessionList: {
            emits: ["manageProjects"],
            template:
              "<button data-manage-projects @click=\"$emit('manageProjects')\">项目管理</button>",
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("项目设置");
    await wrapper.get("[data-manage-projects]").trigger("click");
    expect(wrapper.emitted("manageProjects")).toHaveLength(1);
    wrapper.unmount();
  },
);

it("opens skills and MCP servers from the bottom of the sidebar", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  const wrapper = mount(ProjectSidebar, {
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: {
        Sidebar: slot,
        SidebarContent: slot,
        SidebarFooter: footerSlot,
        SidebarMenu: slot,
        SidebarMenuButton: buttonSlot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        AllProjectsSessionList: true,
      },
    },
  });
  await flushPromises();

  const buttons = wrapper.get("footer").findAll("button");
  expect(buttons.map((button) => button.text())).toEqual([
    "工作技能⌘S",
    "MCP 服务器⌘L",
  ]);
  await buttons[0].trigger("click");
  await buttons[1].trigger("click");
  expect(wrapper.emitted("manageSkills")).toHaveLength(1);
  expect(wrapper.emitted("manageMcp")).toHaveLength(1);
  wrapper.unmount();
});
