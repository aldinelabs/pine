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
    attachTo: document.body,
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
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        Item: itemStub,
        ScrollArea: passthroughStub,
        Select: passthroughStub,
        SelectContent: passthroughStub,
        SelectGroup: passthroughStub,
        SelectItem: passthroughStub,
        SelectSeparator: passthroughStub,
        SelectTrigger: passthroughStub,
        SelectValue: passthroughStub,
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
license: MIT
allowed-tools: read bash Bash(git:*)
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

function findButton(
  wrapper: ReturnType<typeof mountDialog>,
  text: string,
): ReturnType<ReturnType<typeof mountDialog>["get"]> | undefined {
  return wrapper.findAll("button").find((button) => button.text() === text);
}

async function openDialog() {
  const wrapper = mountDialog();
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

describe("SkillManagerDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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

  it("offers to create a skill together with Pine", async () => {
    const wrapper = await openDialog();

    const button = wrapper.get('[data-testid="skill-create-with-pine"]');
    expect(button.text()).toContain("和 Pine 协作管理");
    await button.trigger("click");

    expect(wrapper.emitted("createWithPine")).toEqual([["project-1"]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("opens the first Skill and keeps frontmatter out of the editor", async () => {
    const wrapper = await openDialog();

    expect(readSkill).toHaveBeenCalledWith(
      expect.objectContaining({ name: "release-notes", scope: "global" }),
    );
    const body = wrapper.get<HTMLTextAreaElement>("#skill-global-body");
    expect(body.element.value).toContain("# Release notes");
    expect(body.element.value).not.toContain("name: release-notes");
    expect(body.element.value).not.toContain("custom-field: keep-me");

    // Known tools become toggles; anything else stays as its own entry.
    expect(
      wrapper.get('[data-testid="skill-tool-read"]').attributes("data-state"),
    ).toBe("on");
    expect(
      wrapper.get('[data-testid="skill-tool-edit"]').attributes("data-state"),
    ).toBe("off");
    expect(wrapper.text()).toContain("Bash(git:*)");
  });

  it("enables Save only after a change and preserves frontmatter", async () => {
    const wrapper = await openDialog();
    const saveButton = wrapper.get('[data-testid="skill-save"]');
    expect(saveButton.attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="skill-unsaved"]').exists()).toBe(false);

    await wrapper.get("#skill-global-body").setValue("# Release notes v2");
    expect(saveButton.attributes("disabled")).toBeUndefined();
    expect(wrapper.find('[data-testid="skill-unsaved"]').exists()).toBe(true);

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(editSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "release-notes",
        projectId: "project-1",
        scope: "global",
      }),
    );
    const savedContent = editSkill.mock.calls[0]?.[0].content as string;
    expect(savedContent).toContain("disable-model-invocation: true");
    expect(savedContent).toContain("custom-field: keep-me");
    expect(savedContent).toContain("license: MIT");
    expect(savedContent).toContain("allowed-tools: read bash Bash(git:*)");
    expect(savedContent).toContain("# Release notes v2");
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
      const wrapper = await openDialog();
      const list = () => wrapper.get("aside").element as HTMLElement;
      const editor = () => wrapper.get("form").element as HTMLElement;
      expect(list().style.display).toBe("");
      expect(editor().style.display).toBe("none");
      expect(readSkill).not.toHaveBeenCalled();

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

  it("guides a new Skill to a valid name and description", async () => {
    const wrapper = await openDialog();
    await wrapper.get('[data-testid="skill-new"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="skill-draft-item"]').text()).toContain(
      "未命名 Skill",
    );
    const nameInput = wrapper.get<HTMLInputElement>("#skill-global-name");
    await nameInput.setValue("Release Notes_v2!");
    expect(nameInput.element.value).toBe("release-notes-v2");
    expect(wrapper.get('[data-testid="skill-draft-item"]').text()).toContain(
      "release-notes-v2",
    );

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(createSkill).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("请描述这个 Skill 的用途和使用时机");

    await wrapper
      .get("#skill-global-description")
      .setValue("When release notes are requested.");
    expect(wrapper.text()).not.toContain("请描述这个 Skill 的用途和使用时机");
    await wrapper.get('[data-testid="skill-tool-web_fetch"]').trigger("click");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ name: "release-notes-v2", scope: "global" }),
    );
    const content = createSkill.mock.calls[0]?.[0].content as string;
    expect(content).toContain("description: When release notes are requested.");
    expect(content).toContain("allowed-tools: web_fetch");
    expect(content).not.toContain("license:");
  });

  it("flags a name that ends with a hyphen", async () => {
    const wrapper = await openDialog();
    await wrapper.get('[data-testid="skill-new"]').trigger("click");
    const nameInput = wrapper.get("#skill-global-name");
    await nameInput.setValue("draft-");
    await nameInput.trigger("blur");

    expect(wrapper.text()).toContain("不能以连字符结尾");
  });

  it("fills empty instructions from a template", async () => {
    const wrapper = await openDialog();
    await wrapper.get('[data-testid="skill-new"]').trigger("click");
    await flushPromises();

    await wrapper
      .get('[data-testid="skill-template-workflow"]')
      .trigger("click");

    const body = wrapper.get<HTMLTextAreaElement>("#skill-global-body");
    expect(body.element.value).toContain("## 步骤");
    expect(wrapper.find('[data-testid="skill-templates"]').exists()).toBe(
      false,
    );
  });

  it("returns to the first Skill when creation is cancelled", async () => {
    const wrapper = await openDialog();
    await wrapper.get('[data-testid="skill-new"]').trigger("click");
    await flushPromises();
    await findButton(wrapper, "取消")?.trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="skill-draft-item"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.get<HTMLTextAreaElement>("#skill-global-body").element.value,
    ).toContain("# Release notes");
  });

  it("shows an empty state when the scope has no Skills", async () => {
    listSkills.mockResolvedValue({ diagnostics: [], skills: [] });

    const wrapper = await openDialog();

    expect(wrapper.find('[data-testid="skill-empty"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("这个空间还没有 Skill");
    expect(wrapper.find("#skill-global-name").exists()).toBe(false);
  });

  it("confirms before removing a Skill", async () => {
    const wrapper = await openDialog();

    await findButton(wrapper, "删除")?.trigger("click");
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

  it("hides delete while creating a Skill", async () => {
    const wrapper = await openDialog();
    await wrapper.get('[data-testid="skill-new"]').trigger("click");
    await flushPromises();

    expect(findButton(wrapper, "删除")).toBeUndefined();
  });
});
