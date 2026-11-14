import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import MindMapPreviewRenderer from "../MindMapPreviewRenderer.vue";
import {
  loadImage,
  mountRenderer,
  stubObjectUrls,
} from "./visualRendererHarness";

const sheets = vi.hoisted(() => ({ value: [{ title: "Plan" }] }));

vi.mock("@/lib/mindmap", () => ({
  readMindMap: () => Promise.resolve(sheets.value),
  renderMindMap: () => "<svg />",
}));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mountMap() {
  stubObjectUrls();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(4)))),
  );
  return mountRenderer(MindMapPreviewRenderer, "/p/ideas.xmind", {
    kind: "document",
    url: "pine-project-media://preview/ideas",
    size: 4,
    modifiedAt: "",
  });
}

describe("MindMapPreviewRenderer", () => {
  it("offers the drawn map as an area target once it loads", async () => {
    sheets.value = [{ title: "Plan" }];
    const { wrapper, renderer, handle } = mountMap();
    await flushPromises();
    const image = await loadImage(wrapper, 900, 500);
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      toolbar: false,
      annotateRegions: true,
    });
    expect(handle().annotationTargets()).toEqual([
      { element: image, size: { width: 900, height: 500 } },
    ]);
  });

  it("names sheets and turns to a comment's sheet", async () => {
    sheets.value = [{ title: "Plan" }, { title: "" }];
    const { wrapper, renderer, handle } = mountMap();
    await flushPromises();
    expect(renderer.emitted("capabilitiesChange")?.at(-1)?.[0]).toMatchObject({
      zoom: true,
      toolbar: true,
    });
    await loadImage(wrapper);
    expect(handle().annotationTargets()).toMatchObject([
      { segment: "sheet:0", place: { kind: "sheet", name: "Plan" } },
    ]);
    await handle().revealAnnotation({ segment: "sheet:1" });
    await flushPromises();
    expect(handle().annotationTargets()).toMatchObject([
      { segment: "sheet:1", place: { kind: "sheet", name: "Sheet 2" } },
    ]);
    await handle().revealAnnotation({ place: { kind: "sheet", name: "Plan" } });
    await flushPromises();
    expect(handle().annotationTargets()).toMatchObject([
      { segment: "sheet:0" },
    ]);
  });
});
