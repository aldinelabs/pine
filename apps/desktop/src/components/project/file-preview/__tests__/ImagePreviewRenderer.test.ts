import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, provide, shallowRef } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ImagePreviewRenderer from "../ImagePreviewRenderer.vue";
import { previewToolbarKey, type RenderablePreview } from "../previewRenderer";

vi.mock("@/lib/imageDecoding", () => ({
  decodeHeic: vi.fn(() =>
    Promise.resolve(new Blob(["png"], { type: "image/png" })),
  ),
  openTiff: vi.fn(() =>
    Promise.resolve({
      pageCount: 3,
      page: vi.fn(() =>
        Promise.resolve(new Blob(["png"], { type: "image/png" })),
      ),
    }),
  ),
}));

const base = {
  fileName: "photo.png",
  active: true,
  mode: "rendered" as const,
  zoom: 100,
  inverted: false,
  selectionLabel: "",
};

function render(filePath: string, preview: RenderablePreview, zoom = 100) {
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  const Host = defineComponent({
    props: { zoom: { type: Number, default: zoom } },
    setup(hostProps) {
      provide(previewToolbarKey, shallowRef(toolbar));
      return () =>
        h(ImagePreviewRenderer, {
          ...base,
          zoom: hostProps.zoom,
          filePath,
          preview,
        });
    },
  });
  const wrapper = mount(Host, {
    global: { plugins: [createAppI18n("en-US")] },
    attachTo: document.body,
  });
  return {
    wrapper,
    toolbar,
    renderer: wrapper.findComponent(ImagePreviewRenderer),
  };
}

async function loadImage(
  wrapper: ReturnType<typeof render>["wrapper"],
  width = 800,
  height = 600,
) {
  const image = wrapper.get("img");
  Object.defineProperties(image.element, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  });
  await image.trigger("load");
  await flushPromises();
  return image;
}

const document_: RenderablePreview = {
  kind: "document",
  url: "pine-project-media://preview/photo",
  size: 1,
  modifiedAt: "",
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("ImagePreviewRenderer", () => {
  it("shows browser formats from the media URL and reports their size", async () => {
    const { wrapper, renderer } = render("/p/photo.png", document_);
    await flushPromises();
    expect(wrapper.get("img").attributes("src")).toBe(document_.url);
    await loadImage(wrapper);
    expect(renderer.emitted("metadataChange")?.at(-1)).toEqual([
      { width: 800, height: 600 },
    ]);
    expect(renderer.emitted("capabilitiesChange")?.[0]?.[0]).toMatchObject({
      zoom: true,
      fitWidth: true,
      toolbar: true,
    });
  });

  it("scales with the preview zoom and rotates from the top bar", async () => {
    const { wrapper, toolbar } = render("/p/photo.png", document_);
    await flushPromises();
    const image = await loadImage(wrapper, 400, 200);
    await wrapper.setProps({ zoom: 50 });
    await flushPromises();
    expect(image.attributes("style")).toContain("width: 200px");

    toolbar
      .querySelector<HTMLButtonElement>('[aria-label="Rotate right"]')!
      .click();
    await flushPromises();
    expect(image.attributes("style")).toContain("rotate(90deg)");
    // A quarter turn swaps the frame's sides and fits the image again
    // (jsdom lays out nothing, so the fit is the 1% floor).
    const frame = wrapper.get(".image-preview-frame");
    expect(frame.attributes("style")).toBe("width: 2px; height: 4px;");
  });

  it("decodes TIFF pages one at a time and pages through them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(4)))),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:page"),
      revokeObjectURL: vi.fn(),
    });
    const { openTiff } = await import("@/lib/imageDecoding");
    const { wrapper, toolbar, renderer } = render("/p/scan.tiff", document_);
    await flushPromises();
    expect(wrapper.get("img").attributes("src")).toBe("blob:page");
    await loadImage(wrapper);
    expect(renderer.emitted("metadataChange")?.at(-1)?.[0]).toMatchObject({
      pageCount: 3,
    });
    const tiff = await vi.mocked(openTiff).mock.results[0].value;
    expect(tiff.page).toHaveBeenCalledTimes(1);
    toolbar
      .querySelector<HTMLButtonElement>('[aria-label="Next page"]')!
      .click();
    await flushPromises();
    expect(tiff.page).toHaveBeenLastCalledWith(2);
  });

  it("fails when the browser cannot decode the image", async () => {
    const { wrapper, renderer } = render("/p/photo.jxl", document_);
    await flushPromises();
    await wrapper.get("img").trigger("error");
    expect(renderer.emitted("failed")).toHaveLength(1);
  });
});
