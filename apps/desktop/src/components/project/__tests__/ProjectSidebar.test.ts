import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useProjectStore } from "@/stores/project";
import { useProjectSidebarStore } from "@/stores/projectSidebar";
import { useUpdaterStore } from "@/stores/updater";
import ProjectSidebar from "../ProjectSidebar.vue";

beforeEach(() => localStorage.clear());
it("restores the project tab and persists navigation without changing the active conversation", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const projectStore = useProjectStore();
  projectStore.activeProject = {
    id: "one",
    name: "One",
    createdAt: "",
    updatedAt: "",
    schemaVersion: 1,
    defaultFolderId: "folder",
    folders: [],
  };
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
    routes: [
      { path: "/projects/:projectId", component: { template: "<div />" } },
    ],
  });
  await router.push("/projects/one?tab=conversation");
  const slot = { template: "<div><slot /></div>" };
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
  expect(router.currentRoute.value.query).toEqual({
    tab: "conversation",
    sidebar: "sessions",
  });
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
  expect(footerText.indexOf("新版本 Pine 可用")).toBeLessThan(
    footerText.indexOf("项目设置"),
  );
  expect(footerText).not.toContain("工作技能");
  expect(footerText).not.toContain("MCP");
  projectStore.activeProject = { ...projectStore.activeProject, id: "two" };
  await router.push("/projects/two");
  await flushPromises();
  expect(tabs[0].attributes("data-state")).toBe("active");
  expect(sidebarStore.stateFor("two").tab).toBe("files");
  expect(wrapper.get("[data-files-scroll]").element).not.toBe(files);
  wrapper.unmount();
});
