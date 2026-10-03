import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useProjectStore } from "@/stores/project";
import { useProjectSidebarStore } from "@/stores/projectSidebar";
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

it("restores each project's sidebar tab and keeps every open project's panels", async () => {
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
  const sidebarStore = useProjectSidebarStore();
  useUpdaterStore().update = {
    changelog: "Changes",
    internalVersion: "2.0.0",
    publishedAt: "2026-09-15",
    version: "2.0.0",
  };
  sidebarStore.setTab("one", "files");
  sidebarStore.setTab("two", "files");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/?tab=conversation");
  const wrapper = mount(ProjectSidebar, {
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: {
        Sidebar: slot,
        SidebarContent: slot,
        SidebarFooter: slot,
        SidebarHeader: slot,
        SidebarMenu: slot,
        SidebarMenuButton: slot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        ProjectFileTree: { template: "<div data-files-scroll />" },
        ProjectSessionList: { template: "<div data-sessions-scroll />" },
      },
    },
  });
  const tabs = wrapper.findAll('[role="tab"]');
  const files = wrapper.get<HTMLElement>("[data-files-scroll]").element;
  files.scrollTop = 340;
  expect(wrapper.find("[data-sessions-scroll]").exists()).toBe(false);
  expect(tabs[0].attributes("data-state")).toBe("active");
  await tabs[1].trigger("mousedown", { button: 0 });
  await flushPromises();
  // The sidebar tab is UI state of the project, not of the route.
  expect(router.currentRoute.value.query).toEqual({ tab: "conversation" });
  expect(sidebarStore.stateFor("one").tab).toBe("sessions");
  const sessions = wrapper.get<HTMLElement>("[data-sessions-scroll]").element;
  sessions.scrollTop = 720;
  expect(wrapper.get("[data-files-scroll]").element).toBe(files);
  const hiddenPanel = wrapper.get('[role="tabpanel"][data-state="inactive"]');
  expect(hiddenPanel.attributes("hidden")).toBeUndefined();
  expect(hiddenPanel.attributes("inert")).toBeDefined();
  expect(hiddenPanel.attributes("aria-hidden")).toBe("true");
  await tabs[0].trigger("mousedown", { button: 0 });
  await flushPromises();
  expect(files.scrollTop).toBe(340);
  await tabs[1].trigger("mousedown", { button: 0 });
  await flushPromises();
  expect(wrapper.get("[data-sessions-scroll]").element).toBe(sessions);
  expect(sessions.scrollTop).toBe(720);
  const footerText = wrapper.text();
  expect(footerText.indexOf("项目设置")).toBeLessThan(
    footerText.indexOf("新版本 Pine 可用"),
  );
  expect(footerText).not.toContain("工作技能");
  expect(footerText).not.toContain("MCP");
  showProject({ ...projectStore.activeProject!, id: "two" });
  await flushPromises();
  expect(tabs[0].attributes("data-state")).toBe("active");
  expect(sidebarStore.stateFor("two").tab).toBe("files");
  // Switching projects swaps visible panels; project one's tree survives.
  const fileTrees = wrapper.findAll("[data-files-scroll]");
  expect(fileTrees).toHaveLength(2);
  expect(fileTrees[0].element).toBe(files);
  expect(files.scrollTop).toBe(340);

  showProject({ ...projectStore.activeProject!, id: "one" });
  await flushPromises();
  expect(tabs[1].attributes("data-state")).toBe("active");
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
        SidebarHeader: slot,
        SidebarMenu: slot,
        SidebarMenuButton: buttonSlot,
        SidebarMenuItem: slot,
        SidebarRail: true,
        ProjectFileTree: true,
        ProjectSessionList: true,
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
