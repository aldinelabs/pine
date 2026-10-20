import { mount } from "@vue/test-utils";
import { defineComponent, h, useTemplateRef } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHeightGlide } from "../useHeightGlide";

let notify: () => void = () => {};
let contentHeight = 48;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    () => contentHeight,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountGlide() {
  const animate = vi.fn(() => new EventTarget() as Animation);
  const wrapper = mount(
    defineComponent({
      setup() {
        useHeightGlide(useTemplateRef("box"), useTemplateRef("content"));
        return () =>
          h("div", { ref: "box" }, [h("div", { ref: "content" }, "rows")]);
      },
    }),
  );
  Object.assign(wrapper.element, { animate, getAnimations: () => [] });
  return { wrapper, animate };
}

it("glides from the old height to the new one as rows come and go", () => {
  const { wrapper, animate } = mountGlide();

  notify();
  expect(animate).not.toHaveBeenCalled();
  contentHeight = 72;
  notify();

  expect(animate).toHaveBeenCalledWith(
    [{ height: "48px" }, { height: "72px" }],
    { duration: 500, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
  wrapper.unmount();
});

it("ignores resizes that keep the height", () => {
  contentHeight = 48;
  const { wrapper, animate } = mountGlide();

  notify();
  notify();

  expect(animate).not.toHaveBeenCalled();
  wrapper.unmount();
});
