import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ZoomableImage from "../ZoomableImage.vue";

const STAGE = { width: 1000, height: 600 };
const NATURAL = { width: 2000, height: 1000 };

/** Mounts with a sized stage; happy-dom lays nothing out on its own. */
function mountImage(props: Record<string, unknown>) {
  const sizes: [string, number][] = [
    ["clientWidth", STAGE.width],
    ["clientHeight", STAGE.height],
  ];
  const own = sizes.map(([key]) =>
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  );
  const original = sizes.map(([key]) => {
    let proto: object | null = HTMLElement.prototype;
    while (proto && !Object.getOwnPropertyDescriptor(proto, key)) {
      proto = Object.getPrototypeOf(proto);
    }
    return Object.getOwnPropertyDescriptor(proto!, key)!;
  });
  for (const [index, [key, size]] of sizes.entries()) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.slot === "image-preview"
          ? size
          : (original[index].get!.call(this) as number);
      },
    });
  }
  const wrapper = mount(ZoomableImage, {
    attachTo: document.body,
    props: { src: "/a.png", alt: "A", zoom: 100, ...props },
  });
  return {
    wrapper,
    restore: () => {
      wrapper.unmount();
      for (const [index, [key]] of sizes.entries()) {
        const descriptor = own[index];
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, key, descriptor);
        } else {
          delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
            key
          ];
        }
      }
    },
  };
}

describe("ZoomableImage", () => {
  it("shows and fits a known size before the image loads", async () => {
    const { wrapper, restore } = mountImage({ naturalSize: NATURAL });
    try {
      await flushPromises();
      const image = wrapper.get("img").element as HTMLImageElement;
      expect(image.style.visibility).toBe("");
      // min((1000 - 48) / 2000, (600 - 48) / 1000) = 0.476
      expect(wrapper.emitted("zoomChange")).toEqual([[48]]);
      expect(image.style.width).toBe("952px");
      expect(image.style.height).toBe("476px");

      Object.defineProperty(image, "naturalWidth", { value: NATURAL.width });
      Object.defineProperty(image, "naturalHeight", { value: NATURAL.height });
      await wrapper.get("img").trigger("load");
      await flushPromises();
      expect(wrapper.emitted("load")).toEqual([[NATURAL]]);
      expect(wrapper.emitted("zoomChange")).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("hides the image until it loads without a known size", async () => {
    const { wrapper, restore } = mountImage({});
    try {
      await flushPromises();
      const image = wrapper.get("img").element as HTMLImageElement;
      expect(image.style.visibility).toBe("hidden");
      Object.defineProperty(image, "naturalWidth", { value: NATURAL.width });
      Object.defineProperty(image, "naturalHeight", { value: NATURAL.height });
      await wrapper.get("img").trigger("load");
      await flushPromises();
      // The default 24px margin on every side.
      expect(wrapper.emitted("zoomChange")).toEqual([[48]]);
      expect(image.style.visibility).toBe("");
    } finally {
      restore();
    }
  });

  it("fits inside the given insets", async () => {
    const { wrapper, restore } = mountImage({
      naturalSize: NATURAL,
      fitInsets: { top: 64, right: 24, bottom: 136, left: 24 },
    });
    try {
      await flushPromises();
      // min((1000 - 48) / 2000, (600 - 200) / 1000) = 0.4
      expect(wrapper.emitted("zoomChange")).toEqual([[40]]);
      const grid = wrapper.get('[data-slot="image-preview"] > div')
        .element as HTMLElement;
      expect(grid.style.padding).toBe("64px 24px 136px");
    } finally {
      restore();
    }
  });

  it("offers the shown image as an area target once its size is known", async () => {
    const { wrapper, restore } = mountImage({});
    try {
      await flushPromises();
      const stage = wrapper.vm as unknown as {
        annotationTarget: () => unknown;
      };
      expect(stage.annotationTarget()).toBeUndefined();
      const image = wrapper.get("img").element as HTMLImageElement;
      Object.defineProperty(image, "naturalWidth", { value: NATURAL.width });
      Object.defineProperty(image, "naturalHeight", { value: NATURAL.height });
      await wrapper.get("img").trigger("load");
      await flushPromises();
      // The image itself, whose box follows zoom and scrolling.
      expect(stage.annotationTarget()).toEqual({
        element: image,
        size: NATURAL,
      });
    } finally {
      restore();
    }
  });

  it("offers no area target while the image is turned", async () => {
    const { wrapper, restore } = mountImage({
      naturalSize: NATURAL,
      rotation: 90,
    });
    try {
      await flushPromises();
      const stage = wrapper.vm as unknown as {
        annotationTarget: () => unknown;
      };
      expect(stage.annotationTarget()).toBeUndefined();
      await wrapper.setProps({ rotation: 360 });
      expect(stage.annotationTarget()).toMatchObject({ size: NATURAL });
    } finally {
      restore();
    }
  });
});
