import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { ArtifactVersionDiff as Diff } from "@/shared/artifacts";
import ArtifactVersionDiff from "../ArtifactVersionDiff.vue";

const diff: Diff = {
  status: "ok",
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { type: "remove", text: "Budget is 30 thousand." },
        { type: "add", text: "Budget is 35 thousand." },
      ],
    },
  ],
  before: "# Plan\n\nBudget is 30 thousand.\n",
  after: "# Plan\n\nBudget is 35 thousand.\n",
};

function render(fileName: string) {
  return mount(ArtifactVersionDiff, {
    props: { diff, fileName },
    global: { plugins: [createPinia(), createAppI18n("en-US")] },
  });
}

describe("ArtifactVersionDiff", () => {
  it("renders a Markdown comparison and can switch to the source", async () => {
    const wrapper = render("plan.md");
    await flushPromises();

    const rendered = wrapper.get('[data-testid="markdown-version-diff"]');
    expect(rendered.find("del").text()).toBe("30");
    expect(rendered.find("ins").text()).toBe("35");

    await wrapper
      .get('[data-testid="artifact-version-diff-source"]')
      .trigger("click");
    expect(wrapper.find('[data-testid="markdown-version-diff"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).toContain("−Budget is 30 thousand.");
  });

  it("shows other text files line by line without the switch", () => {
    const wrapper = render("notes.txt");

    expect(
      wrapper.find('[data-testid="artifact-version-diff-rendered"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).toContain("+Budget is 35 thousand.");
  });
});
