import { createTestingPinia } from "@pinia/testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, provide, shallowRef, type Component } from "vue";
import { vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  previewToolbarKey,
  type PreviewRendererHandle,
  type RenderablePreview,
} from "../previewRenderer";

export const textPreview = (text = ""): RenderablePreview => ({
  kind: "text",
  text,
  encoding: "utf-8",
  size: text.length,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

/** Mounts a renderer with a top bar, i18n and stores, as the preview does. */
export function mountRenderer(
  component: Component,
  filePath: string,
  preview: RenderablePreview = textPreview(),
) {
  const toolbar = document.createElement("div");
  document.body.append(toolbar);
  const Host = defineComponent({
    setup() {
      provide(previewToolbarKey, shallowRef(toolbar));
      return () =>
        h(component, {
          preview,
          fileName: filePath.split("/").at(-1),
          filePath,
          active: true,
          mode: "rendered",
          zoom: 100,
          inverted: false,
          selectionLabel: "",
        });
    },
  });
  const wrapper = mount(Host, {
    global: {
      plugins: [
        createAppI18n("en-US"),
        createTestingPinia({ createSpy: vi.fn }),
      ],
    },
    attachTo: document.body,
  });
  const renderer = wrapper.findComponent(component) as VueWrapper;
  return {
    wrapper,
    toolbar,
    renderer,
    handle: () => renderer.vm as unknown as Required<PreviewRendererHandle>,
  };
}

/** Lets the stage's image finish loading at a natural size. */
export async function loadImage(
  wrapper: VueWrapper,
  width = 800,
  height = 600,
) {
  const image = wrapper.get("img");
  Object.defineProperties(image.element, {
    naturalWidth: { value: width, configurable: true },
    naturalHeight: { value: height, configurable: true },
  });
  await image.trigger("load");
  await flushPromises();
  return image.element;
}

/** Object URLs that happy-dom can hand out and take back. */
export function stubObjectUrls(): void {
  let next = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => `blob:${(next += 1)}`),
    revokeObjectURL: vi.fn(),
  });
}
