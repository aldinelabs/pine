import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { useHelpStore } from "@/stores/help";
import HelpHint from "../HelpHint.vue";

function mountHint(props: Record<string, unknown>) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(HelpHint, {
    props,
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  return { wrapper, help: useHelpStore() };
}

describe("HelpHint", () => {
  it("opens its guide at the given step", async () => {
    const { wrapper, help } = mountHint({ topic: "approval-modes", step: 2 });
    const button = wrapper.get("[data-slot=help-hint]");
    expect(button.attributes("aria-label")).toBe(
      "Learn about Tool calls and approvals",
    );
    expect(button.attributes("aria-haspopup")).toBe("dialog");
    await button.trigger("click");
    expect(help.topicId).toBe("approval-modes");
    expect(help.step).toBe(2);
    expect(wrapper.emitted("open")).toHaveLength(1);
  });

  it("only explains when it has no topic", async () => {
    const { wrapper, help } = mountHint({ label: "About this" });
    const button = wrapper.get("[data-slot=help-hint]");
    expect(button.attributes("aria-label")).toBe("About this");
    await button.trigger("click");
    expect(help.topicId).toBeNull();
  });
});
