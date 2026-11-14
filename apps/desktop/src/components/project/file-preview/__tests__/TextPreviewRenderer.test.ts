import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { codeToHtml } from "@/lib/codeHighlight";
import { filePreviewExcluded } from "@/lib/filePreviewSelection";
import type { PreviewRendererHandle } from "../previewRenderer";
import { previewRenderers } from "../previewRenderers";
import TextPreviewRenderer from "../TextPreviewRenderer.vue";

vi.mock("@/lib/codeHighlight", () => ({ codeToHtml: vi.fn() }));

function mountText(text: string, filePath: string, mode: "code" | "rendered") {
  return mount(TextPreviewRenderer, {
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
    props: {
      preview: {
        kind: "text",
        text,
        encoding: "UTF-8",
        size: text.length,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      fileName: filePath,
      filePath,
      active: true,
      mode,
      zoom: 100,
      inverted: false,
      selectionLabel: "Selection",
    },
  });
}

describe("TextPreviewRenderer annotations", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(codeToHtml).mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("IntersectionObserver", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("anchors code view comments in the source, outside the line numbers", async () => {
    const wrapper = mountText("first\nsecond\nthird", "notes.ts", "code");
    await flushPromises();
    const handle = wrapper.vm as unknown as PreviewRendererHandle;

    const surface = handle.annotationSurface?.();
    const code = wrapper.get("pre code").element;
    expect(surface).toEqual({ root: code });
    expect(code.closest(".code-preview-gutter")).toBeNull();

    const text = code.firstChild!;
    const range = document.createRange();
    range.setStart(text, "first\n".length);
    range.setEnd(text, "first\nsecond\nth".length);
    expect(handle.annotationLines?.(range)).toEqual({
      startLine: 2,
      endLine: 3,
    });
    wrapper.unmount();
  });

  it("anchors rendered Markdown comments in the rendered blocks", async () => {
    const wrapper = mountText(
      "# Title\n\nFirst paragraph.\n\nSecond paragraph.",
      "notes.md",
      "rendered",
    );
    await flushPromises();
    const handle = wrapper.vm as unknown as PreviewRendererHandle;

    const surface = handle.annotationSurface?.();
    const renderer = wrapper.get(".markdown-renderer").element;
    expect(surface).toEqual({ root: renderer, excluded: filePreviewExcluded });

    const paragraph = [...renderer.querySelectorAll("p")].find(
      (element) => element.textContent === "Second paragraph.",
    )!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    expect(handle.annotationLines?.(range)).toEqual({
      startLine: 5,
      endLine: 5,
    });

    const empty = document.createRange();
    empty.setStart(paragraph, 0);
    expect(handle.annotationLines?.(empty)).toBeUndefined();
    wrapper.unmount();
  });

  it("offers comments on text in both views", () => {
    const text = previewRenderers.find((renderer) => renderer.id === "text")!;
    for (const mode of ["code", "rendered"] as const) {
      expect(
        text.capabilities({
          preview: {
            kind: "text",
            text: "",
            encoding: "UTF-8",
            size: 0,
            modifiedAt: "2026-01-01T00:00:00.000Z",
          },
          filePath: "notes.md",
          mode,
        }).annotate,
      ).toBe(true);
    }
  });
});
