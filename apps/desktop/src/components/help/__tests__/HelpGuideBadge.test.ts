import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppearanceStore } from "@/stores/appearance";
import { useHelpStore } from "@/stores/help";
import HelpGuideBadge from "../HelpGuideBadge.vue";

beforeEach(() => {
  window.localStorage.clear();
  setActivePinia(createPinia());
});

describe("HelpGuideBadge", () => {
  it("opens its guide from beside a dialog title", async () => {
    const wrapper = mount(HelpGuideBadge, {
      props: { topic: "memory", label: "How memory works" },
    });
    const badge = wrapper.get('[data-slot="help-guide-badge"]');
    expect(badge.text()).toBe("How memory works");
    expect(badge.attributes("aria-haspopup")).toBe("dialog");
    await badge.trigger("click");
    expect(useHelpStore().topicId).toBe("memory");
    expect(useHelpStore().step).toBe(0);
  });

  it("disappears with Guide buttons off", async () => {
    const wrapper = mount(HelpGuideBadge, {
      props: { topic: "skills", label: "How Skills work" },
    });
    useAppearanceStore().setHelpGuides(false);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-slot="help-guide-badge"]').exists()).toBe(false);
  });
});
