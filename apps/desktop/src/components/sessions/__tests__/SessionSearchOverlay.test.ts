import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Command } from "@/components/ui/command";
import type { PineProject } from "@/shared/projects";
import type { ProjectSessionSearchResult } from "@/shared/sessions";
import { useProjectStore } from "@/stores/project";
import SessionSearchOverlay from "../SessionSearchOverlay.vue";

const openSession = vi.fn();
vi.mock("@/composables/useContentTabNavigation", () => ({
  useContentTabNavigation: () => ({
    activeSessionTab: ref(null),
    openSession,
  }),
}));

const commandDialogStub = defineComponent({
  name: "CommandDialogStub",
  props: { description: String, open: Boolean, title: String },
  setup(_props, { slots }) {
    return () => h(Command, null, { default: () => slots.default?.() });
  },
});

function project(id: string, name: string): PineProject {
  return {
    createdAt: "2026-10-01T00:00:00.000Z",
    defaultFolderId: "folder",
    folders: [],
    id,
    name,
    schemaVersion: 1,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

const sessions: ProjectSessionSearchResult[] = [
  {
    createdAt: "2026-10-29T00:00:00.000Z",
    id: "session-1",
    messageCount: 1,
    name: "导出 PDF",
    projectId: "project-1",
    updatedAt: "2026-10-29T00:00:00.000Z",
  },
  {
    createdAt: "2026-10-28T00:00:00.000Z",
    id: "session-2",
    messageCount: 1,
    name: "问候",
    projectId: "project-2",
    updatedAt: "2026-10-28T00:00:00.000Z",
  },
];

async function mountOverlay() {
  setActivePinia(createPinia());
  const searchAllSessions = vi.fn().mockResolvedValue({ sessions });
  Object.assign(window, { pine: { searchAllSessions } });
  const projectStore = useProjectStore();
  projectStore.projects = [
    project("project-1", "Pine"),
    project("project-2", "Notes"),
  ];
  const ensureOpen = vi
    .spyOn(projectStore, "ensureOpen")
    .mockResolvedValue({ opened: true } as Awaited<
      ReturnType<typeof projectStore.ensureOpen>
    >);

  const wrapper = mount(SessionSearchOverlay, {
    props: { open: true },
    global: {
      plugins: [createAppI18n("zh-CN")],
      stubs: { CommandDialog: commandDialogStub },
    },
  });
  await vi.waitFor(() => expect(searchAllSessions).toHaveBeenCalled());
  await flushPromises();
  return { ensureOpen, searchAllSessions, wrapper };
}

describe("SessionSearchOverlay", () => {
  it("searches every project and tags each session with its project", async () => {
    const { searchAllSessions, wrapper } = await mountOverlay();

    expect(searchAllSessions).toHaveBeenCalledWith({ query: "" });
    expect(
      wrapper
        .findAll('[data-testid="session-search-project"]')
        .map((tag) => tag.text()),
    ).toEqual(["Pine", "Notes"]);
  });

  it("opens a session in its own project", async () => {
    const { ensureOpen, wrapper } = await mountOverlay();

    await wrapper.findAll('[data-slot="command-item"]')[1].trigger("click");
    await flushPromises();

    expect(ensureOpen).toHaveBeenCalledWith("project-2");
    expect(openSession).toHaveBeenCalledWith(sessions[1], "project-2");
  });
});
