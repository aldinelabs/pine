import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import AutomationManagerDialog from "../AutomationManagerDialog.vue";

const passthrough = { template: "<div><slot /></div>" };
const dialog = {
  props: ["open"],
  template: '<div v-if="open" data-dialog><slot /></div>',
};
const stubs = {
  Dialog: dialog,
  AutomationDetailDialog: true,
  AutomationApprovalCard: true,
  ...Object.fromEntries(
    [
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
      "Empty",
      "EmptyDescription",
      "EmptyHeader",
      "EmptyMedia",
      "EmptyTitle",
      "Field",
      "FieldDescription",
      "FieldError",
      "FieldGroup",
      "FieldLabel",
      "Item",
      "ItemActions",
      "ItemContent",
      "ItemDescription",
      "ItemGroup",
      "ItemTitle",
      "ScrollArea",
      "Switch",
      "Tabs",
      "TabsContent",
      "TabsList",
      "TabsTrigger",
    ].map((name) => [name, passthrough]),
  ),
};

vi.mock("@/composables/useAutomationRunSession", () => ({
  useAutomationRunSession: () => ({ openRun: vi.fn() }),
}));

const check = vi.fn();
const save = vi.fn();

function mountDialog() {
  return mount(AutomationManagerDialog, {
    props: { open: true, projectId: "project-1" },
    global: { plugins: [createAppI18n("zh-CN")], stubs },
  });
}

describe("AutomationManagerDialog", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    check.mockReset();
    save.mockReset();
    window.pine = {
      runtime: "desktop",
      automations: {
        runs: vi.fn().mockResolvedValue([]),
        list: vi.fn().mockResolvedValue([]),
        secrets: vi.fn().mockResolvedValue([]),
        check,
        save,
      },
    } as unknown as Window["pine"];
  });

  it("hands creation to a conversation with Pine and closes", async () => {
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .get('[data-testid="automation-create-with-pine"]')
      .trigger("click");
    expect(wrapper.emitted("createWithPine")).toEqual([["project-1"]]);
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
  });

  it("checks and saves a hand-written definition", async () => {
    check.mockResolvedValue({ errors: [], warnings: ["Heads up"] });
    save.mockResolvedValue({ id: "daily", revision: 1 });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .get('[data-testid="automation-create-manually"]')
      .trigger("click");
    await flushPromises();

    const textarea = wrapper.get<HTMLTextAreaElement>("#automation-definition");
    expect(JSON.parse(textarea.element.value)).toMatchObject({ version: 1 });
    await textarea.setValue('{"version":1,"name":"Daily"}');
    const button = (label: string) =>
      wrapper
        .get('[data-testid="automation-editor"]')
        .findAll("button")
        .find((candidate) => candidate.text() === label)!;
    await button("检查").trigger("click");
    await flushPromises();
    expect(check).toHaveBeenCalledWith({
      projectId: "project-1",
      spec: { version: 1, name: "Daily" },
      dryRun: true,
    });
    expect(wrapper.text()).toContain("Heads up");

    await button("保存").trigger("click");
    await flushPromises();
    expect(save).toHaveBeenCalledWith({
      projectId: "project-1",
      spec: { version: 1, name: "Daily" },
    });
  });

  it("shows why a definition was not saved", async () => {
    save.mockResolvedValue({ errors: ["name is required"] });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .get('[data-testid="automation-create-manually"]')
      .trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="automation-editor"]')
      .findAll("button")
      .find((candidate) => candidate.text() === "保存")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("name is required");
  });
});
