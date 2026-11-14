import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import OfdPreviewRenderer from "../OfdPreviewRenderer.vue";
import { mountRenderer } from "./visualRendererHarness";

vi.mock("@file-viewer-internal/ofd", () => ({
  parseOfdDocument: (options: { success: (documents: unknown[]) => void }) =>
    options.success([{ pages: 2 }]),
  // ofd.js draws each page into a sized element with SVG text.
  renderOfd: (width: number) =>
    [1, 2].map((number) => {
      const page = document.createElement("div");
      page.style.width = `${width}px`;
      page.innerHTML = `<svg><text>Page ${number}</text></svg>`;
      return page;
    }),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("OfdPreviewRenderer", () => {
  it("offers each page for passages and areas once rendered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(4)))),
    );
    const { wrapper, renderer, handle } = mountRenderer(
      OfdPreviewRenderer,
      "/p/invoice.ofd",
      {
        kind: "document",
        url: "pine-project-media://preview/invoice",
        size: 4,
        modifiedAt: "",
      },
    );
    await flushPromises();
    await flushPromises();
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      annotate: true,
      annotateRegions: true,
    });

    const pages = wrapper
      .findAll(".ofd-page-frame > div")
      .map((page) => page.element);
    expect(pages).toHaveLength(2);
    // The page element itself, not its frame, which also holds ofd.js's margin.
    expect(handle().annotationTargets()).toEqual([
      {
        element: pages[0],
        segment: "page:1",
        place: { kind: "page", number: 1 },
      },
      {
        element: pages[1],
        segment: "page:2",
        place: { kind: "page", number: 2 },
      },
    ]);
    expect(handle().annotationSurfaces()).toEqual([
      { root: pages[0], segment: "page:1", place: { kind: "page", number: 1 } },
      { root: pages[1], segment: "page:2", place: { kind: "page", number: 2 } },
    ]);

    const scrolled = vi.fn();
    (pages[1].parentElement as HTMLElement).scrollIntoView = scrolled;
    await handle().revealAnnotation({ segment: "page:2" });
    expect(scrolled).toHaveBeenCalledOnce();
  });
});
