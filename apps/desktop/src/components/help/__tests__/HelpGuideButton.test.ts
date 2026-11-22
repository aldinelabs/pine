import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";
import HelpGuideButton from "../HelpGuideButton.vue";

function mountButton() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(HelpGuideButton, {
    props: { topic: "context-window", label: "How context works", step: 2 },
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  return { wrapper, help: useHelpStore(), appearance: useAppearanceStore() };
}

describe("HelpGuideButton", () => {
  it("names the guide and opens it at the given step", async () => {
    const { wrapper, help } = mountButton();
    const button = wrapper.get("[data-slot=help-guide-button]");
    expect(button.text()).toBe("How context works");
    expect(button.attributes("aria-haspopup")).toBe("dialog");
    await button.trigger("click");
    expect(help.topicId).toBe("context-window");
    expect(help.step).toBe(2);
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("hides with Guide buttons turned off", async () => {
    const { wrapper, appearance } = mountButton();
    appearance.setHelpGuides(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-slot=help-guide-button]").exists()).toBe(false);
    appearance.setHelpGuides(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-slot=help-guide-button]").exists()).toBe(true);
  });
});
