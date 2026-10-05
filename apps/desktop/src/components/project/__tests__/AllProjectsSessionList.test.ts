import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
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

async function mountList() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push("/");
  const openProject = vi.fn(({ id }: { id: string }) =>
    Promise.resolve({ opened: true, project: { id } }),
  );
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      listAllRecentSessions: vi.fn().mockResolvedValue({ sessions }),
      openProject,
    },
  });
  const projectStore = useProjectStore();
  projectStore.projects = [noProject, pine];
  projectStore.openProjectIds = new Set([noProject.id]);
  projectStore.setCurrentProject(noProject.id);
  const wrapper = mount(AllProjectsSessionList, {
    global: {
      plugins: [pinia, router, createAppI18n("zh-CN")],
      stubs: {
        SidebarGroup: { template: "<div><slot /></div>" },
        SidebarGroupContent: { template: "<div><slot /></div>" },
        SidebarGroupLabel: { template: "<div><slot /></div>" },
        SidebarMenu: { template: "<div><slot /></div>" },
        SidebarMenuButton: {
          template: '<button v-bind="$attrs"><slot /></button>',
        },
        SidebarMenuItem: { template: "<div><slot /></div>" },
        SidebarMenuSkeleton: true,
      },
    },
  });
  await flushPromises();
  return { router, wrapper, openProject };
}

describe("AllProjectsSessionList", () => {
  it("lists every project's sessions with their project and no groups", async () => {
    const { wrapper } = await mountList();
    const rows = wrapper.findAll("[data-session-id]");
    expect(rows.map((row) => row.attributes("data-session-id"))).toEqual(
      sessions.map((session) => session.id),
    );
    expect(rows[0].text()).toContain("Fix the tab bar");
    expect(rows[0].get('[data-slot="session-project"]').text()).toBe("Pine");
    expect(rows[1].text()).toContain("Plan a trip");
    expect(rows[1].get('[data-slot="session-project"]').text()).toBe("无项目");
    expect(wrapper.text()).not.toContain("新建分组");
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
});
