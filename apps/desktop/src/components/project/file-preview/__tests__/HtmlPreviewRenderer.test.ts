import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import HtmlPreviewRenderer from "../HtmlPreviewRenderer.vue";
import type { PreviewRendererHandle } from "../previewRenderer";

async function render(compact = false) {
  const wrapper = mount(HtmlPreviewRenderer, {
    props: {
      preview: {
        kind: "text",
        text: "<p>Hello</p>",
        encoding: "utf-8",
        size: 12,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      fileName: "page.html",
      filePath: "page.html",
      active: true,
      mode: "rendered",
      zoom: 100,
      inverted: false,
      selectionLabel: "",
      compact,
    },
  });
  await flushPromises();
  const frame = wrapper.get("iframe");
  // The test environment gives srcdoc frames no document of their own.
  const page = document.implementation.createHTMLDocument("page");
  Object.defineProperty(frame.element, "contentDocument", { value: page });
  const handle = wrapper.vm as unknown as Required<PreviewRendererHandle>;
  return { wrapper, frame, page, handle };
}

describe("HtmlPreviewRenderer", () => {
  it("offers the page's body for comments once the frame loads", async () => {
    const { wrapper, frame, page, handle } = await render();
    expect(handle.annotationSurface()).toBeUndefined();
    expect(wrapper.emitted("capabilitiesChange")).toBeUndefined();

    await frame.trigger("load");
    expect(handle.annotationSurface()).toEqual({ root: page.body });
    expect(wrapper.emitted("capabilitiesChange")).toEqual([
      [{ annotate: true }],
    ]);

    await frame.trigger("load");
    expect(wrapper.emitted("capabilitiesChange")).toHaveLength(2);
  });

  it("offers no comments in a compact card", async () => {
    const { wrapper, frame } = await render(true);
    await frame.trigger("load");
    expect(wrapper.emitted("capabilitiesChange")).toBeUndefined();
  });
});
