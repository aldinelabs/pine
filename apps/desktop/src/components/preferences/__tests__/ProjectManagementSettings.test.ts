import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  TEMPORARY_WORKSPACE_FOLDER_ID,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "@/shared/projects";
import ProjectManagementSettings from "../ProjectManagementSettings.vue";

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "pine",
      path: "/Users/me/pine",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "Pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};
const workspace: PineProject = {
  ...project,
  defaultFolderId: TEMPORARY_WORKSPACE_FOLDER_ID,
  id: TEMPORARY_WORKSPACE_PROJECT_ID,
  name: "Temporary Workspace",
};
const usage = {
  projectId: project.id,
  attachments: 2 * 1024 ** 2,
  cache: 1024,
  sessions: 5 * 1024 ** 2,
  temporary: 10 * 1024 ** 3,
  total: 10 * 1024 ** 3 + 7 * 1024 ** 2 + 1024,
};

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function mountSettings() {
  const clearProjectStorage = vi.fn().mockResolvedValue({
    ...usage,
    attachments: 0,
    total: usage.total - usage.attachments,
  });
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      listProjects: vi
        .fn()
        .mockResolvedValue({ projects: [workspace, project] }),
      getProjectStorage: vi.fn().mockResolvedValue({
        usage: [{ ...usage, projectId: workspace.id, total: 0 }, usage],
      }),
      clearProjectStorage,
    },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(ProjectManagementSettings, {
    attachTo: document.body,
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: { ProjectDialog: true },
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, clearProjectStorage };
}

/** The most recently opened menu's item; earlier menus may linger. */
function menuItem(action: string): DOMWrapper<Element> {
  return new DOMWrapper(
    [...document.querySelectorAll(`[data-action="${action}"]`)].at(-1),
  );
}

it("lists every project with Pine's data usage", async () => {
  const { wrapper } = await mountSettings();
  const rows = wrapper.findAll('[data-slot="project-management-row"]');

  expect(rows).toHaveLength(2);
  expect(rows[0].text()).toContain("临时工作空间");
  expect(rows[1].text()).toContain("/Users/me/pine");
  expect(rows[1].text()).toContain("临时文件 10 GB");
  expect(rows[1].text()).toContain("附件 2 MB");
});

it("asks before clearing attachments and only edits real projects", async () => {
  const { wrapper, clearProjectStorage } = await mountSettings();
  const rows = wrapper.findAll('[data-slot="project-management-row"]');

  await rows[0].get('button[aria-label$="操作"]').trigger("click");
  await flushPromises();
  expect(document.querySelector('[data-action="edit-project"]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await flushPromises();

  await rows[1].get('button[aria-label$="操作"]').trigger("click");
  await flushPromises();
  expect(document.querySelector('[data-action="edit-project"]')).not.toBeNull();
  await menuItem("clear-attachments").trigger("click");
  await flushPromises();
  expect(clearProjectStorage).not.toHaveBeenCalled();

  await menuItem("confirm-clear-attachments").trigger("click");
  await flushPromises();
  expect(clearProjectStorage).toHaveBeenCalledWith({
    id: project.id,
    kind: "attachments",
  });
  expect(
    wrapper.findAll('[data-slot="project-management-row"]')[1].text(),
  ).toContain("附件 0 B");
});
