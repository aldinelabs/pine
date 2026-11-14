import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PostScriptPreviewRenderer from "../PostScriptPreviewRenderer.vue";
import {
  loadImage,
  mountRenderer,
  stubObjectUrls,
  textPreview,
} from "./visualRendererHarness";

vi.mock("@/lib/postscript", () => ({
  readPostScript: () => ({ kind: "tiff", tiff: new ArrayBuffer(4) }),
}));
vi.mock("@/lib/imageDecoding", () => ({
  openTiff: () =>
    Promise.resolve({
      pageCount: 1,
      page: () => Promise.resolve(new Blob(["png"], { type: "image/png" })),
    }),
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("PostScriptPreviewRenderer", () => {
  it("offers its preview image as an area target", async () => {
    stubObjectUrls();
    const { wrapper, renderer, handle } = mountRenderer(
      PostScriptPreviewRenderer,
      "/p/logo.eps",
      textPreview("%!PS"),
    );
    await flushPromises();
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      annotateRegions: true,
    });
    expect(handle().annotationTargets()).toEqual([]);
    const image = await loadImage(wrapper, 300, 200);
    expect(handle().annotationTargets()).toEqual([
      { element: image, size: { width: 300, height: 200 } },
    ]);
    // Only an embedded PDF has passages to comment on.
    expect(handle().annotationSurfaces()).toEqual([]);
  });
});
