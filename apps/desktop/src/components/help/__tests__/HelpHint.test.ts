import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";
import HelpHint from "../HelpHint.vue";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

function mountHint() {
  return mount(HelpHint, {
    props: {
      label: "About compaction",
      guide: { topic: "context-window", step: 2 },
    },
    slots: { default: "Compacts at 80%." },
  });
}

describe("HelpHint", () => {
  it("opens its guide when clicked", async () => {
    const wrapper = mountHint();
    const button = wrapper.get('[data-slot="help-hint-guide"]');
    expect(button.attributes("aria-label")).toBe("About compaction");
    await button.trigger("click");
    expect(useHelpStore().topicId).toBe("context-window");
    expect(useHelpStore().step).toBe(2);
  });

  it("falls back to its description with Guide buttons off", () => {
    useAppearanceStore().setHelpGuides(false);
    const wrapper = mountHint();
    expect(wrapper.find('[data-slot="help-hint-guide"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="About compaction"]').exists()).toBe(
      true,
    );
  });
});
