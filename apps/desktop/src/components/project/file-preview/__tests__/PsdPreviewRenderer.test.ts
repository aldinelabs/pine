import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PsdPreviewRenderer from "../PsdPreviewRenderer.vue";
import {
  loadImage,
  mountRenderer,
  stubObjectUrls,
} from "./visualRendererHarness";

vi.mock("ag-psd", () => ({
  readPsd: () => ({ width: 640, height: 480, children: [] }),
}));
vi.mock("@/lib/psdComposite", () => ({
  layerTree: () => [],
  hasRealComposite: () => false,
  compositeToBlob: () =>
    Promise.resolve(new Blob(["png"], { type: "image/png" })),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("PsdPreviewRenderer", () => {
  it("offers the composite image as an area target once it loads", async () => {
    stubObjectUrls();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(4)))),
    );
    const { wrapper, renderer, handle } = mountRenderer(
      PsdPreviewRenderer,
      "/p/art.psd",
      {
        kind: "document",
        url: "pine-project-media://preview/art",
        size: 4,
        modifiedAt: "",
      },
    );
    await flushPromises();
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      annotateRegions: false,
    });
    const image = await loadImage(wrapper, 640, 480);
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toEqual({
      zoom: true,
      fitWidth: true,
      zoomMin: 10,
      zoomMax: 800,
      annotateRegions: true,
    });
    expect(renderer.emitted("metadataChange")?.at(-1)).toEqual([
      { width: 640, height: 480 },
    ]);
    expect(handle().annotationTargets()).toEqual([
      { element: image, size: { width: 640, height: 480 } },
    ]);
  });
});
