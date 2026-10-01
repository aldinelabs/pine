import { FILE_TAB_DRAG_TYPE } from "@/lib/contentTabDrag";
import { SESSION_DRAG_TYPE } from "@/lib/sessionDrag";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineProject } from "@/shared/projects";
import type { PineSessionSummary } from "@/shared/sessions";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import ProjectSessionList from "../ProjectSessionList.vue";

const session: PineSessionSummary = {
  createdAt: "2026-08-25T00:00:00.000Z",
  id: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
  messageCount: 2,
  preview: "Existing conversation",
  updatedAt: "2026-08-25T00:01:00.000Z",
};

const project: PineProject = {
  createdAt: "2026-08-24T00:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "source",
      path: "/projects/source",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "Pine",
  schemaVersion: 1,
  updatedAt: "2026-08-24T00:00:00.000Z",
};

describe("ProjectSessionList", () => {
  it("exposes sidebar conversations as internal attachment drags", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
      },
    });
    useProjectStore().activeProject = project;
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          SidebarGroup: { template: "<div><slot /></div>" },
          SidebarGroupContent: { template: "<div><slot /></div>" },
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
    const data = new Map<string, string>();
    const transfer = {
      setData: (type: string, value: string) => data.set(type, value),
      effectAllowed: "none",
    };

    const item = wrapper.get(`[data-session-id="${session.id}"]`);
    expect(item.attributes("draggable")).toBe("true");
    await item.trigger("dragstart", { dataTransfer: transfer });

    expect(data.get(SESSION_DRAG_TYPE)).toBe(session.id);
    expect(transfer.effectAllowed).toBe("copyMove");
    wrapper.unmount();
  });

  it("moves a conversation into a group when dropped on the group", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    const group = {
      id: "group-1",
      name: "Planning",
      sessionIds: [],
    };
    const groupedProject: PineProject = {
      ...project,
      sessionGroups: [group],
    };
    const updatedProject: PineProject = {
      ...groupedProject,
      sessionGroups: [{ ...group, sessionIds: [session.id] }],
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    const updateProjectSessionGroups = vi.fn().mockResolvedValue({
      project: updatedProject,
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
        updateProjectSessionGroups,
      },
    });
    useProjectStore().activeProject = groupedProject;
    const slotStub = { template: "<div><slot /></div>" };
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          ContextMenu: slotStub,
          ContextMenuContent: slotStub,
          ContextMenuGroup: slotStub,
          ContextMenuItem: slotStub,
          ContextMenuSub: slotStub,
          ContextMenuSubContent: slotStub,
          ContextMenuSubTrigger: slotStub,
          ContextMenuTrigger: slotStub,
          DropdownMenu: slotStub,
          DropdownMenuContent: slotStub,
          DropdownMenuGroup: slotStub,
          DropdownMenuItem: slotStub,
          DropdownMenuTrigger: slotStub,
          ScrollArea: slotStub,
          SidebarGroup: slotStub,
          SidebarGroupContent: slotStub,
          SidebarGroupLabel: slotStub,
          SidebarMenu: slotStub,
          SidebarMenuButton: {
            template: '<button v-bind="$attrs"><slot /></button>',
          },
          SidebarMenuItem: slotStub,
          SidebarMenuSkeleton: true,
          SessionContextMenu: slotStub,
        },
      },
    });
    await flushPromises();

    const data = new Map<string, string>();
    const transfer = {
      types: [],
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      dropEffect: "none",
    };
    const source = wrapper.get(`[data-session-id="${session.id}"]`);
    await source.trigger("dragstart", { dataTransfer: transfer });
    expect(data.get(SESSION_DRAG_TYPE)).toBe(session.id);
    const target = wrapper.get("[data-session-group-drop-target]");
    await target.trigger("dragover", { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("move");

    await target.trigger("drop", { dataTransfer: transfer });
    await flushPromises();

    expect(updateProjectSessionGroups).toHaveBeenCalledWith({
      id: project.id,
      sessionGroups: [{ ...group, sessionIds: [session.id] }],
    });
    wrapper.unmount();
  });

  it("accepts a file tab drop, opens the target session, and adds its attachment", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: {} }],
    });
    await router.push("/");
    const attachment = {
      name: "notes.md",
      path: "/project/notes.md",
      extension: "md",
      size: 12,
      modifiedAt: "",
    };
    const inspectProjectAttachments = vi
      .fn()
      .mockResolvedValue({ attachments: [attachment] });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
        inspectProjectAttachments,
      },
    });
    useProjectStore().activeProject = project;
    const store = useContentTabsStore();
    const file = store.openFile({
      projectId: project.id,
      folderId: project.defaultFolderId,
      relativePath: "notes.md",
    });
    const slotStub = { template: "<div><slot /></div>" };
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          SidebarGroup: slotStub,
          SidebarGroupContent: slotStub,
          SidebarMenu: slotStub,
          SidebarMenuItem: slotStub,
          SidebarMenuButton: { template: "<button><slot /></button>" },
          SidebarMenuSkeleton: true,
        },
      },
    });
    await flushPromises();
    const target = wrapper.get(`[data-session-id="${session.id}"]`);
    const transfer = {
      types: [FILE_TAB_DRAG_TYPE],
      getData: () => file.id,
      dropEffect: "none",
    };
    await target.trigger("dragover", { dataTransfer: transfer });
    expect(transfer.dropEffect).toBe("copy");
    await target.trigger("drop", { dataTransfer: transfer });
    await flushPromises();
    const tab = store.tabs.find(
      (tab) => tab.kind === "session" && tab.state === "bound",
    );
    expect(tab).toMatchObject({ sessionId: session.id });
    expect(router.currentRoute.value.query.tab).toBe(tab?.id);
    expect(store.attachmentsFor(tab!.id)).toEqual([attachment]);
    expect(store.tabs.find((tab) => tab.id === file.id)).toBeDefined();
    wrapper.unmount();
  });

  it("opens a new draft tab from the new-session action", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push({ path: "/", query: { tab: "session-1" } });
    await router.isReady();
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
      },
    });
    const tabsStore = useContentTabsStore();
    tabsStore.bindSession("session-1", session);
    useProjectStore().activeProject = project;
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          SidebarGroup: { template: "<div><slot /></div>" },
          SidebarGroupContent: { template: "<div><slot /></div>" },
          SidebarMenu: { template: "<div><slot /></div>" },
          SidebarMenuButton: { template: "<button><slot /></button>" },
          SidebarMenuItem: { template: "<div><slot /></div>" },
          SidebarMenuSkeleton: true,
        },
      },
    });
    await flushPromises();

    const newSessionButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("New session"));
    expect(newSessionButton).toBeDefined();
    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text().includes("New group")),
    ).toBe(true);
    await newSessionButton?.trigger("click");
    await flushPromises();

    const activeTabId = String(router.currentRoute.value.query.tab);
    expect(tabsStore.tabs.find((tab) => tab.id === activeTabId)).toEqual(
      expect.objectContaining({ state: "draft" }),
    );
    expect(tabsStore.tabs.filter((tab) => tab.kind === "session")).toHaveLength(
      2,
    );
  });

  it("reloads history when the active project's folders change", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const searchSessions = vi.fn().mockResolvedValue({ sessions: [session] });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { searchSessions },
    });
    const projectStore = useProjectStore();
    projectStore.activeProject = project;

    mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          SidebarGroup: { template: "<div><slot /></div>" },
          SidebarGroupContent: { template: "<div><slot /></div>" },
          SidebarMenu: { template: "<div><slot /></div>" },
          SidebarMenuButton: { template: "<button><slot /></button>" },
          SidebarMenuItem: { template: "<div><slot /></div>" },
          SidebarMenuSkeleton: true,
        },
      },
    });
    await flushPromises();
    expect(searchSessions).toHaveBeenCalledTimes(1);

    projectStore.activeProject = {
      ...project,
      defaultFolderId: "9e775dc8-27f1-4eaf-89c9-e5b1b4a65ae5",
      folders: [
        ...project.folders,
        {
          access: "read-write",
          id: "9e775dc8-27f1-4eaf-89c9-e5b1b4a65ae5",
          isAvailable: true,
          name: "next-source",
          path: "/projects/next-source",
        },
      ],
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    await flushPromises();

    expect(searchSessions).toHaveBeenCalledTimes(2);
  });

  it("renames a session from the context menu dialog", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push({ path: "/", query: { tab: "session-1" } });
    await router.isReady();
    const renamedSession = { ...session, name: "Renamed conversation" };
    const renameSession = vi
      .fn()
      .mockResolvedValue({ session: renamedSession });
    const exportSession = vi.fn().mockResolvedValue({
      path: "/tmp/Existing conversation.md",
      saved: true,
    });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        exportSession,
        renameSession,
        searchSessions: vi.fn().mockResolvedValue({ sessions: [session] }),
      },
    });
    const tabsStore = useContentTabsStore();
    tabsStore.bindSession("session-1", session);
    useProjectStore().activeProject = project;
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          ContextMenu: { template: "<div><slot /></div>" },
          ContextMenuContent: { template: "<div><slot /></div>" },
          ContextMenuGroup: { template: "<div><slot /></div>" },
          ContextMenuItem: {
            emits: ["select"],
            template:
              '<button data-slot="context-menu-item" @click="$emit(\'select\')"><slot /></button>',
          },
          ContextMenuTrigger: { template: "<div><slot /></div>" },
          Dialog: {
            props: ["open"],
            template: '<div v-if="open"><slot /></div>',
          },
          DialogContent: { template: "<div><slot /></div>" },
          DialogDescription: { template: "<p><slot /></p>" },
          DialogFooter: { template: "<footer><slot /></footer>" },
          DialogHeader: { template: "<header><slot /></header>" },
          DialogTitle: { template: "<h2><slot /></h2>" },
          ScrollArea: { template: "<div><slot /></div>" },
          SidebarGroup: { template: "<div><slot /></div>" },
          SidebarGroupContent: { template: "<div><slot /></div>" },
          SidebarMenu: { template: "<div><slot /></div>" },
          SidebarMenuButton: { template: "<button><slot /></button>" },
          SidebarMenuItem: { template: "<div><slot /></div>" },
          SidebarMenuSkeleton: true,
        },
      },
    });
    await flushPromises();

    const exportAction = wrapper
      .findAll('[data-slot="context-menu-item"]')
      .find((item) => item.text().includes("Export conversation"));
    expect(exportAction).toBeDefined();
    await exportAction?.trigger("click");
    await flushPromises();
    expect(exportSession).toHaveBeenCalledWith({ sessionId: session.id });

    const renameAction = wrapper
      .findAll('[data-slot="context-menu-item"]')
      .find((item) => item.text().includes("Rename conversation"));
    expect(renameAction).toBeDefined();
    await renameAction?.trigger("click");

    const input = wrapper.get("#session-name");
    expect((input.element as HTMLInputElement).value).toBe(
      "Existing conversation",
    );
    await input.setValue("Renamed conversation");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: session.id,
      name: "Renamed conversation",
    });
    expect(tabsStore.tabs[0]).toEqual(
      expect.objectContaining({ label: "Renamed conversation" }),
    );
    expect(wrapper.find("#session-name").exists()).toBe(false);
  });

  it("buckets conversations by age and shows no per-row date", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }],
    });
    await router.push("/");
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const sessions: PineSessionSummary[] = [
      { ...session, id: "recent", preview: "Recent", updatedAt: daysAgo(1) },
      { ...session, id: "week", preview: "Last week", updatedAt: daysAgo(5) },
      {
        ...session,
        id: "month",
        preview: "Last month",
        updatedAt: daysAgo(10),
      },
      {
        ...session,
        id: "ancient",
        preview: "Ancient",
        updatedAt: daysAgo(400),
      },
    ];
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { searchSessions: vi.fn().mockResolvedValue({ sessions }) },
    });
    useProjectStore().activeProject = project;
    const slotStub = { template: "<div><slot /></div>" };
    const wrapper = mount(ProjectSessionList, {
      global: {
        plugins: [pinia, router, createAppI18n("en-US")],
        stubs: {
          ScrollArea: slotStub,
          SidebarGroup: { template: '<div data-slot="group"><slot /></div>' },
          SidebarGroupContent: slotStub,
          SidebarGroupLabel: {
            template: '<div data-slot="group-label"><slot /></div>',
          },
          SidebarMenu: slotStub,
          SidebarMenuButton: { template: "<button><slot /></button>" },
          SidebarMenuItem: slotStub,
          SidebarMenuSkeleton: true,
        },
      },
    });
    await flushPromises();

    const groups = wrapper
      .findAll('[data-slot="group"]')
      .filter((group) => group.find('[data-slot="group-label"]').exists());

    expect(
      groups.map((group) => group.get('[data-slot="group-label"]').text()),
    ).toEqual(["Past 3 days", "Past week", "Past month", "Older"]);
    // Each row only renders its title, so the grouped rows carry no date.
    expect(
      groups.map((group) =>
        group.findAll("[data-session-id]").map((item) => item.text()),
      ),
    ).toEqual([["Recent"], ["Last week"], ["Last month"], ["Ancient"]]);
    wrapper.unmount();
  });
});
