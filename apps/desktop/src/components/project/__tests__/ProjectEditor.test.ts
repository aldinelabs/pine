import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineProject } from "@/shared/projects";
import ProjectEditor from "../ProjectEditor.vue";

const project: PineProject = {
  createdAt: "2026-08-19T12:00:00.000Z",
  defaultFolderId: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
  folders: [
    {
      access: "read-write",
      id: "cde9a86c-7632-43ac-96d6-c41ddeddce0e",
      isAvailable: true,
      name: "Downloads",
      path: "/Users/kw/Downloads",
    },
  ],
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "Pine",
  schemaVersion: 1,
  updatedAt: "2026-08-19T12:00:00.000Z",
};

function mountEditor(value: PineProject | null = project) {
  return mount(ProjectEditor, {
    props: { project: value },
    global: { plugins: [createAppI18n("zh-CN")] },
  });
}

describe("ProjectEditor", () => {
  it("offers deletion only when editing an existing project", async () => {
    const wrapper = mountEditor();
    await wrapper.get('[data-action="delete-project"]').trigger("click");
    expect(wrapper.emitted("delete")).toHaveLength(1);

    expect(
      mountEditor(null).find('[data-action="delete-project"]').exists(),
    ).toBe(false);
  });

  it("renders the selected default folder without editable controls", async () => {
    const wrapper = mountEditor({
      ...project,
      folders: [{ ...project.folders[0], access: "read-only" }],
    });

    expect(wrapper.findAll('[data-testid="default-folder-row"]')).toHaveLength(
      1,
    );
    expect(wrapper.get('[data-testid="default-folder-row"]').text()).toContain(
      project.folders[0].path,
    );
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(
      wrapper
        .get('[data-testid="default-folder-row"]')
        .find('[role="combobox"]')
        .exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain("项目元数据");

    expect(
      wrapper
        .get('[data-testid="default-folder-row"]')
        .find('[data-testid="folder-name-input"]')
        .exists(),
    ).toBe(false);
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0]).toEqual([
      {
        defaultFolderId: project.defaultFolderId,
        folders: [
          {
            access: "read-write",
            id: project.folders[0].id,
            name: project.folders[0].name,
            path: project.folders[0].path,
          },
        ],
        name: project.name,
        projectColorTheme: "olive",
        projectIcon: "inbox",
      },
    ]);
  });

  it("submits the icon chosen next to the project name", async () => {
    const wrapper = mount(ProjectEditor, {
      props: { project: { ...project, projectIcon: "code" } },
      attachTo: document.body,
      global: { plugins: [createAppI18n("zh-CN")] },
    });

    await wrapper.get('[data-slot="project-icon-trigger"]').trigger("click");
    const option = document.body.querySelector<HTMLElement>(
      '[data-slot="project-icon-option"][data-icon-name="rocket"]',
    );
    expect(
      document.body
        .querySelector('[data-icon-name="code"]')
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    option?.click();
    await wrapper.vm.$nextTick();
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({
      projectIcon: "rocket",
    });
    wrapper.unmount();
  });

  it("removes an additional context folder without removing the default", async () => {
    const contextFolder = {
      access: "read-only" as const,
      id: "1030d3de-4c20-4e23-aaca-0e5d70bd21e4",
      isAvailable: true,
      name: "Notes",
      path: "/Users/kw/Notes",
    };
    const wrapper = mountEditor({
      ...project,
      folders: [...project.folders, contextFolder],
    });
    const removeButton = wrapper.get('[aria-label="移除文件夹"]');

    expect(wrapper.find('[data-testid="default-folder-row"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="context-folder-row"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="context-folder-table"]').exists()).toBe(
      true,
    );
    await removeButton.trigger("click");

    expect(wrapper.find('[data-testid="context-folder-row"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="default-folder-row"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="context-folder-table"]').exists()).toBe(
      false,
    );
  });

  it("uses separate native picker modes for default and context folders", async () => {
    const pickProjectFolders = vi
      .fn()
      .mockResolvedValueOnce({ folders: [] })
      .mockResolvedValueOnce({ folders: [] });
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { pickProjectFolders },
    });
    const createWrapper = mountEditor(null);

    await createWrapper
      .get('[data-testid="choose-default-folder"]')
      .trigger("click");
    expect(pickProjectFolders).toHaveBeenNthCalledWith(1, { mode: "default" });

    await createWrapper
      .get('[data-testid="add-context-folders"]')
      .trigger("click");
    expect(pickProjectFolders).toHaveBeenNthCalledWith(2, { mode: "context" });
  });

  it("does not render a context folder list when none are configured", () => {
    const wrapper = mountEditor();

    expect(wrapper.find('[data-testid="context-folder-row"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="context-folder-table"]').exists()).toBe(
      false,
    );
  });
});
