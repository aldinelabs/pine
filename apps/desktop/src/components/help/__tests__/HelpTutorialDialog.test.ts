import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { HELP_ILLUSTRATIONS } from "@/components/help/illustrations";
import { useHelpStore } from "@/stores/help";
import HelpTutorialDialog from "../HelpTutorialDialog.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function find(selector: string): DOMWrapper<Element> {
  return new DOMWrapper(document.querySelector(selector));
}

async function mountDialog(locale: "en-US" | "zh-CN" | "ja-JP" = "en-US") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(HelpTutorialDialog, {
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n(locale)] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return useHelpStore();
}

describe("HelpTutorialDialog", () => {
  it("stays closed until a topic is opened", async () => {
    await mountDialog();
    expect(document.querySelector("[data-testid=help-tutorial]")).toBeNull();
  });

  it("steps through a guide and closes on Done", async () => {
    const help = await mountDialog();
    help.openTopic("approval-modes");
    await flushPromises();

    const dialog = find("[data-testid=help-tutorial]");
    expect(dialog.text()).toContain("An agent acts through tools");
    expect(dialog.text()).toContain("Step 1 of 4");
    expect(document.querySelector("[data-testid=help-previous]")).toBeNull();

    await find("[data-testid=help-next]").trigger("click");
    expect(find("[data-testid=help-tutorial]").text()).toContain(
      "The four approval modes",
    );
    await find("[data-testid=help-previous]").trigger("click");
    expect(help.step).toBe(0);

    help.openTopic("approval-modes", 3);
    await flushPromises();
    expect(find("[data-testid=help-next]").text()).toBe("Done");
    await find("[data-testid=help-next]").trigger("click");
    await flushPromises();
    expect(help.topicId).toBeNull();
  });

  it("moves with the arrow keys and the step dots", async () => {
    const help = await mountDialog();
    help.openTopic("context-window");
    await flushPromises();
    await find("[data-testid=help-tutorial]").trigger("keydown", {
      key: "ArrowRight",
    });
    expect(help.step).toBe(1);
    const dots = document.querySelectorAll("[data-slot=help-steps] button");
    expect(dots).toHaveLength(4);
    await new DOMWrapper(dots[3]).trigger("click");
    expect(help.step).toBe(3);
    await find("[data-testid=help-tutorial]").trigger("keydown", {
      key: "ArrowLeft",
    });
    expect(help.step).toBe(2);
  });

  it("clamps a deep link past the last step", async () => {
    const help = await mountDialog();
    help.openTopic("context-window", 99);
    await flushPromises();
    expect(help.step).toBe(3);
  });

  it("shows the Chinese guide, and English where none is written", async () => {
    const help = await mountDialog("zh-CN");
    help.openTopic("context-window");
    await flushPromises();
    expect(find("[data-testid=help-tutorial]").text()).toContain(
      "上下文是模型的工作台",
    );
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());

    const japanese = await mountDialog("ja-JP");
    japanese.openTopic("context-window");
    await flushPromises();
    const dialog = find("[data-testid=help-tutorial]");
    expect(dialog.attributes("lang")).toBe("en-US");
    expect(dialog.text()).toContain("Context is the model's desk");
    expect(dialog.text()).toContain("ステップ 1 / 4");
  });

  it("renders every illustration", () => {
    for (const component of Object.values(HELP_ILLUSTRATIONS)) {
      const wrapper = mount(component, {
        global: { plugins: [createAppI18n("en-US")] },
      });
      expect(wrapper.html()).not.toBe("");
      wrapper.unmount();
    }
  });
});
