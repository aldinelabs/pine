import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type {
  ListSkillsResult,
  PineSkillSummary,
  ReadSkillResult,
} from "@/shared/skills";
import SkillManagerDialog from "../SkillManagerDialog.vue";

const listSkills = vi.fn();
const readSkill = vi.fn();
const createSkill = vi.fn();
const editSkill = vi.fn();
const removeSkill = vi.fn();
const setGlobalSkillEnabled = vi.fn();

const passthroughStub = { template: "<div><slot /></div>" };
const itemStub = {
  props: ["as", "type"],
  template: '<component :is="as || \'div\'" :type="type"><slot /></component>',
};
const alertDialogStub = {
  props: ["open"],
  template: '<div v-if="open"><slot /></div>',
};
const alertDialogActionStub = {
  emits: ["click"],
  template:
    '<button data-alert-confirm type="button" @click="$emit(\'click\')"><slot /></button>',
};

function installPineApi(): void {
  window.pine = {
    listSkills,
    readSkill,
    createSkill,
    editSkill,
    removeSkill,
    setGlobalSkillEnabled,
  } as unknown as Window["pine"];
}

function mountDialog() {
  return mount(SkillManagerDialog, {
    props: { open: false, projectId: "project-1" },
    global: {
      plugins: [createAppI18n("zh-CN")],
      stubs: {
        AlertDialog: alertDialogStub,
        AlertDialogAction: alertDialogActionStub,
        AlertDialogCancel: passthroughStub,
        AlertDialogContent: passthroughStub,
        AlertDialogDescription: passthroughStub,
        AlertDialogFooter: passthroughStub,
        AlertDialogHeader: passthroughStub,
        AlertDialogTitle: passthroughStub,
        Dialog: passthroughStub,
        DialogContent: passthroughStub,
        DialogDescription: passthroughStub,
        DialogFooter: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        Field: passthroughStub,
        FieldGroup: passthroughStub,
        FieldLabel: passthroughStub,
        Item: itemStub,
        ItemActions: passthroughStub,
        ItemContent: passthroughStub,
        ItemDescription: passthroughStub,
        ItemGroup: passthroughStub,
        ItemMedia: passthroughStub,
        ItemTitle: passthroughStub,
        ScrollArea: passthroughStub,
        Separator: passthroughStub,
        Switch: passthroughStub,
        Tabs: passthroughStub,
        TabsContent: passthroughStub,
        TabsList: passthroughStub,
        TabsTrigger: passthroughStub,
      },
    },
  });
}

const globalSkill: PineSkillSummary = {
  description: "Release notes formatting guidance.",
  disableModelInvocation: true,
  name: "release-notes",
  scope: "global",
};

const loadedSkillContent = `---
name: release-notes
description: Release notes formatting guidance.
disable-model-invocation: true
custom-field: keep-me
---

# Release notes

Use the project changelog format.
`;

function listResult(): ListSkillsResult {
  return { diagnostics: [], skills: [globalSkill] };
}

function readResult(): ReadSkillResult {
  return { content: loadedSkillContent, skill: globalSkill };
}

describe("SkillManagerDialog", () => {
  beforeEach(() => {
    listSkills.mockReset();
    readSkill.mockReset();
    createSkill.mockReset();
    editSkill.mockReset();
    removeSkill.mockReset();
    setGlobalSkillEnabled.mockReset();
    listSkills.mockResolvedValue(listResult());
    readSkill.mockResolvedValue(readResult());
    createSkill.mockResolvedValue(readResult());
    editSkill.mockResolvedValue(readResult());
    removeSkill.mockResolvedValue({ removed: true });
    setGlobalSkillEnabled.mockResolvedValue({ updated: true });
    installPineApi();
  });

  it("keeps frontmatter out of the editor and preserves it when saving", async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    const textarea = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(textarea.element.value).toBe("");
    expect(readSkill).not.toHaveBeenCalled();

    const skillButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("release-notes"));
    await skillButton?.trigger("click");
    await flushPromises();

    expect(textarea.element.value).toContain("# Release notes");
    expect(textarea.element.value).not.toContain("name: release-notes");
    expect(textarea.element.value).not.toContain("custom-field: keep-me");

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(editSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("disable-model-invocation: true"),
        name: "release-notes",
        projectId: "project-1",
        scope: "global",
      }),
    );
    const savedContent = editSkill.mock.calls[0]?.[0].content as string;
    expect(savedContent).toContain("custom-field: keep-me");
    expect(savedContent).toContain("# Release notes");
  });

  it("shows the skill list and one editor at a time on a phone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(width < 40rem)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      const wrapper = mountDialog();
      await wrapper.setProps({ open: true });
      await flushPromises();
      const list = () => wrapper.get("aside").element as HTMLElement;
      const editor = () => wrapper.get("form").element as HTMLElement;
      expect(list().style.display).toBe("");
      expect(editor().style.display).toBe("none");

      await wrapper
        .findAll("button")
        .find((button) => button.text().includes("release-notes"))
        ?.trigger("click");
      await flushPromises();
      expect(list().style.display).toBe("none");
      expect(editor().style.display).toBe("");
      expect(wrapper.text()).toContain("release-notes");

      await wrapper.get('[data-testid="skill-manager-back"]').trigger("click");
      expect(list().style.display).toBe("");
      expect(editor().style.display).toBe("none");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps Save disabled until description and instructions are present", async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();
    const newSkillButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "新建 Skill");
    await newSkillButton?.trigger("click");

    const nameInput = wrapper.get<HTMLInputElement>(
      'input[placeholder="skill-name"]',
    );
    const descriptionInput = wrapper.get<HTMLInputElement>(
      'input[placeholder="Skill 描述（何时使用）"]',
    );
    const textarea = wrapper.get<HTMLTextAreaElement>("textarea");
    expect(textarea.element.value).toBe("");
    await nameInput.setValue("new-skill");
    await descriptionInput.setValue("");
    await textarea.setValue("# New skill");
    const saveButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "新建");
    expect(saveButton?.attributes("disabled")).toBeDefined();

    await descriptionInput.setValue("When release notes are requested.");
    expect(saveButton?.attributes("disabled")).toBeUndefined();
  });

  it("shows the new Skill card when the scope has no Skills", async () => {
    listSkills.mockResolvedValue({ diagnostics: [], skills: [] });

    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(
      wrapper
        .findAll("button")
        .some((button) => button.text() === "新建 Skill"),
    ).toBe(true);
    expect(wrapper.text()).not.toContain("这个空间还没有 Skill");
  });

  it("confirms before removing a Skill", async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    const skillButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("release-notes"));
    await skillButton?.trigger("click");
    await flushPromises();

    const deleteButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "删除");
    await deleteButton?.trigger("click");
    await wrapper.vm.$nextTick();

    expect(removeSkill).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("删除工作技能？");

    await wrapper.get("[data-alert-confirm]").trigger("click");
    await flushPromises();

    expect(removeSkill).toHaveBeenCalledWith({
      managedBy: "pine",
      name: "release-notes",
      projectId: "project-1",
      scope: "global",
    });
  });
});
