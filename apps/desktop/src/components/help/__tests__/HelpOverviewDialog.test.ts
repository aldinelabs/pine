import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { HELP_TOPIC_GROUPS } from "@/app/help";
import { createAppI18n } from "@/app/i18n";
import { useHelpStore } from "@/stores/help";
import HelpOverviewDialog from "../HelpOverviewDialog.vue";
import HelpTutorialDialog from "../HelpTutorialDialog.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

async function mountDialogs(locale: "en-US" | "zh-CN" = "en-US") {
  const pinia = createPinia();
  setActivePinia(pinia);
  for (const component of [HelpOverviewDialog, HelpTutorialDialog]) {
    const wrapper = mount(component, {
      attachTo: document.body,
      global: { plugins: [pinia, createAppI18n(locale)] },
    });
    wrappers.push(wrapper);
  }
  await flushPromises();
  return useHelpStore();
}

describe("HelpOverviewDialog", () => {
  it("lists every grouped guide and opens one on top of the list", async () => {
    const help = await mountDialogs();
    help.openOverview();
    await flushPromises();

    const overview = new DOMWrapper(
      document.querySelector("[data-testid=help-overview]"),
    );
    expect(overview.text()).toContain("Guides");
    const rows = document.querySelectorAll(
      "[data-testid=help-overview] [data-topic]",
    );
    expect(rows).toHaveLength(
      HELP_TOPIC_GROUPS.flatMap((group) => group.topics).length,
    );

    await new DOMWrapper(
      document.querySelector("[data-topic=steer-stop]"),
    ).trigger("click");
    await flushPromises();
    expect(help.topicId).toBe("steer-stop");
    expect(help.isOverviewOpen).toBe(true);

    help.close();
    await flushPromises();
    expect(
      document.querySelector("[data-testid=help-overview]"),
    ).not.toBeNull();
  });

  it("shows the guides in Chinese", async () => {
    const help = await mountDialogs("zh-CN");
    help.openOverview();
    await flushPromises();
    const overview = new DOMWrapper(
      document.querySelector("[data-testid=help-overview]"),
    );
    expect(overview.text()).toContain("指南");
    expect(overview.text()).toContain("从这里开始");
    expect(overview.text()).toContain("工具调用与审批");
  });
});
