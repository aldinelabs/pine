import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import TypstPreviewRenderer from "../TypstPreviewRenderer.vue";
import { mountRenderer, stubObjectUrls } from "./visualRendererHarness";

vi.mock("@/lib/typst", () => ({
  compileTypst: vi.fn(() => Promise.resolve("<svg />")),
  splitTypstPages: vi.fn(() => [
    { width: 595, height: 842, svg: "<svg />" },
    { width: 842, height: 595, svg: "<svg />" },
  ]),
  typstErrorMessages: vi.fn(() => []),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("TypstPreviewRenderer", () => {
  it("offers each compiled page as an area target", async () => {
    stubObjectUrls();
    const { wrapper, renderer, handle } = mountRenderer(
      TypstPreviewRenderer,
      "/p/doc.typ",
    );
    await flushPromises();
    expect(renderer.emitted("capabilitiesChange")?.[0]?.[0]).toMatchObject({
      annotateRegions: false,
    });
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      invert: true,
      annotateRegions: true,
    });
    // Pages are images without selectable text: areas only.
    expect(
      renderer.emitted("capabilitiesChange")?.at(-1)?.[0],
    ).not.toHaveProperty("annotate");

    const pages = wrapper.findAll("[data-typst-page]");
    expect(handle().annotationTargets()).toEqual([
      {
        element: pages[0].element,
        segment: "page:1",
        place: { kind: "page", number: 1 },
        size: { width: 595, height: 842 },
      },
      {
        element: pages[1].element,
        segment: "page:2",
        place: { kind: "page", number: 2 },
        size: { width: 842, height: 595 },
      },
    ]);
  });

  it("scrolls to a comment's page", async () => {
    stubObjectUrls();
    const { wrapper, handle } = mountRenderer(
      TypstPreviewRenderer,
      "/p/doc.typ",
    );
    await flushPromises();
    const second = wrapper.findAll("[data-typst-page]")[1].element;
    const scrolled = vi.fn();
    second.scrollIntoView = scrolled;
    await handle().revealAnnotation({ place: { kind: "page", number: 2 } });
    expect(scrolled).toHaveBeenCalledOnce();
    await handle().revealAnnotation({ segment: "page:9" });
    expect(scrolled).toHaveBeenCalledOnce();
  });
});
