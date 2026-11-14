import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectQuoteList from "../ProjectQuoteList.vue";

function mountList(quotes: InstanceType<typeof ProjectQuoteList>["quotes"]) {
  return mount(ProjectQuoteList, {
    props: { quotes, surface: "composer" },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("ProjectQuoteList", () => {
  it("shows a plain quote as its passage", () => {
    const wrapper = mountList([{ text: "a passage" }]);
    const chip = wrapper.get('[data-slot="quote"]');
    expect(chip.attributes("title")).toBe("a passage");
    expect(chip.text()).toContain("a passage");
    expect(chip.find('[data-slot="quote-source"]').exists()).toBe(false);
  });

  it("shows a preview comment with where it points", () => {
    const wrapper = mountList([
      {
        text: "const a = 1;",
        file: "/repo/src/a.ts",
        lines: "12-18",
        comment: "Rename this",
      },
      { text: "loose", comment: "Why?" },
    ]);
    const [commented, loose] = wrapper.findAll('[data-slot="quote"]');
    expect(commented.attributes("title")).toBe(
      "/repo/src/a.ts:12-18\nconst a = 1;\nRename this",
    );
    expect(commented.get('[data-slot="quote-source"]').text()).toBe(
      "a.ts:12-18",
    );
    expect(commented.text()).toContain("Rename this");
    expect(commented.text()).not.toContain("const a = 1;");
    expect(loose.attributes("title")).toBe("loose\nWhy?");
    expect(loose.find('[data-slot="quote-source"]').exists()).toBe(false);
  });
});
