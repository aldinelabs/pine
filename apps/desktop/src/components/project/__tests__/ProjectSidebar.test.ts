import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useProjectStore } from "@/stores/project";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { PINE_RELEASES_URL } from "@/shared/window";
import { useUpdaterStore } from "@/stores/updater";
import ProjectSidebar from "../ProjectSidebar.vue";
import { showProject } from "@/stores/__tests__/showProject";

const slot = { template: "<div><slot /></div>" };
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
  useUpdaterStore().update = {
    changelog: "Changes",
    internalVersion: "2.0.0",
    publishedAt: "2026-09-15",
    version: "2.0.0",
  };
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
        SidebarFooter: slot,
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
  const footerText = wrapper.text();
  expect(footerText.indexOf("项目设置")).toBeLessThan(
    footerText.indexOf("新版本 Pine 可用"),
  );

  showProject({ ...projectStore.activeProject!, id: "two" });
  await flushPromises();
  // Switching projects keeps the same list rather than swapping it.
  expect(wrapper.findAll("[data-all-sessions]")).toHaveLength(1);
  expect(wrapper.get("[data-all-sessions]").element).toBe(sessions);
  wrapper.unmount();
});

it("shows the version item that opens releases until an update replaces it", async () => {
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
        SidebarFooter: slot,
        SidebarMenu: slot,
        SidebarMenuButton: buttonSlot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        AllProjectsSessionList: true,
      },
    },
  });
  await flushPromises();
  const version = wrapper.get('[data-testid="pine-version"]');
  expect(version.text()).toBe("版本 0.1.0");
  await version.trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenCalledWith(PINE_RELEASES_URL);

  useUpdaterStore().update = {
    changelog: "Changes",
    internalVersion: "2.0.0",
    publishedAt: "2026-09-15",
    version: "2.0.0",
  };
  await flushPromises();
  expect(wrapper.find('[data-testid="pine-version"]').exists()).toBe(false);
  expect(wrapper.text()).toContain("新版本 Pine 可用");
  wrapper.unmount();
});

it("offers project management instead of settings in No Project", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  useProjectStore().setCurrentProject(TEMPORARY_WORKSPACE_PROJECT_ID);
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
        SidebarFooter: slot,
        SidebarMenu: slot,
        SidebarMenuButton: buttonSlot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        AllProjectsSessionList: true,
      },
    },
  });
  await flushPromises();

  expect(wrapper.text()).not.toContain("项目设置");
  const manage = wrapper
    .findAll("button")
    .find((button) => button.text() === "管理项目");
  if (!manage) throw new Error("Missing the manage projects item");
  await manage.trigger("click");
  expect(wrapper.emitted("manageProjects")).toHaveLength(1);
  expect(wrapper.emitted("editProject")).toBeUndefined();
  wrapper.unmount();
});
