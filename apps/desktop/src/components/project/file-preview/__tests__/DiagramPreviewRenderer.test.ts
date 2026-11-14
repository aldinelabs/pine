import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiagramPreviewRenderer from "../DiagramPreviewRenderer.vue";
import {
  loadImage,
  mountRenderer,
  stubObjectUrls,
  textPreview,
} from "./visualRendererHarness";

vi.mock("@/lib/mermaid", () => ({
  renderMermaid: () => Promise.resolve("<svg />"),
}));
vi.mock("@/lib/drawio", () => ({
  readDrawioPages: () =>
    Promise.resolve([{ name: "One" }, { name: "Two" }, { name: "Three" }]),
  renderDrawioPage: () => "<svg />",
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("DiagramPreviewRenderer", () => {
  it("offers a single diagram without a segment", async () => {
    stubObjectUrls();
    const { wrapper, renderer, handle } = mountRenderer(
      DiagramPreviewRenderer,
      "/p/flow.mmd",
      textPreview("graph TD; A-->B"),
    );
    await flushPromises();
    expect(handle().annotationTargets()).toEqual([]);
    const image = await loadImage(wrapper, 400, 300);
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      annotateRegions: true,
    });
    expect(handle().annotationTargets()).toEqual([
      { element: image, size: { width: 400, height: 300 } },
    ]);
  });

  it("names draw.io pages and turns to a comment's page", async () => {
    stubObjectUrls();
    const { wrapper, handle } = mountRenderer(
      DiagramPreviewRenderer,
      "/p/arch.drawio",
      textPreview("<mxfile />"),
    );
    await flushPromises();
    const image = await loadImage(wrapper, 400, 300);
    expect(handle().annotationTargets()).toEqual([
      {
        element: image,
        segment: "page:1",
        place: { kind: "page", number: 1 },
        size: { width: 400, height: 300 },
      },
    ]);
    await handle().revealAnnotation({
      segment: "page:3",
      place: { kind: "page", number: 3 },
    });
    await flushPromises();
    expect(handle().annotationTargets()).toMatchObject([
      { segment: "page:3", place: { kind: "page", number: 3 } },
    ]);
  });
});
