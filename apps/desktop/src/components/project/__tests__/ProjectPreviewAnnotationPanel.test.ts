import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import ProjectPreviewAnnotationPanel from "../ProjectPreviewAnnotationPanel.vue";

function annotation(
  id: string,
  overrides: Partial<PreviewAnnotation> = {},
): PreviewAnnotation {
  return {
    id,
    mode: "code",
    anchor: { start: 0, end: 5, exact: "hello", prefix: "", suffix: "" },
    lines: { startLine: 3, endLine: 3 },
    text: "hello",
    comment: `comment ${id}`,
    createdAt: 0,
    orphaned: false,
    version: "v1",
    ...overrides,
  };
}

function mountPanel(
  annotations: PreviewAnnotation[],
  props: Partial<{ mode: "code" | "rendered"; hasViews: boolean }> = {},
) {
  return mount(ProjectPreviewAnnotationPanel, {
    attachTo: document.body,
    props: {
      annotations,
      activeId: undefined,
      mode: "code",
      hasViews: false,
      sessionTabs: [],
      sending: false,
      ...props,
    },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

describe("ProjectPreviewAnnotationPanel", () => {
  it("shows an empty state without comments", () => {
    const wrapper = mountPanel([]);
    expect(wrapper.text()).toContain("No comments yet");
    expect(wrapper.find("footer").exists()).toBe(false);
  });

  it("lists comments with their location and state", () => {
    const wrapper = mountPanel(
      [
        annotation("a"),
        annotation("b", {
          mode: "rendered",
          lines: { startLine: 4, endLine: 9 },
          orphaned: true,
        }),
      ],
      { hasViews: true },
    );
    const items = wrapper.findAll("[data-annotation-id]");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Line 3");
    expect(items[0].text()).toContain("comment a");
    expect(items[1].text()).toContain("Lines 4–9");
    expect(items[1].text()).toContain("Rendered view");
    expect(items[1].text()).toContain("Original text changed");
    wrapper.unmount();
  });

  it("selects, edits and removes a comment", async () => {
    const wrapper = mountPanel([annotation("a")]);
    await wrapper.get("[data-annotation-id=a] > button").trigger("click");
    expect(wrapper.emitted("select")).toEqual([["a"]]);

    await wrapper.get('[aria-label="Edit"]').trigger("click");
    const textarea = wrapper.get("textarea");
    await textarea.setValue("  better  ");
    // Shift+Enter and Enter that ends an IME composition stay in the box.
    await textarea.trigger("keydown", { key: "Enter", shiftKey: true });
    await textarea.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.emitted("update")).toBeUndefined();
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update")).toEqual([["a", "better"]]);

    await wrapper.get('[aria-label="Delete"]').trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["a"]]);
    wrapper.unmount();
  });
});
