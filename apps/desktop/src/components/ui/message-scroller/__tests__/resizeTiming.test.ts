import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import MessageScrollerContent from "../MessageScrollerContent.vue";
import MessageScrollerViewport from "../MessageScrollerViewport.vue";
import { provideMessageScroller } from "../useMessageScroller";

describe("message scroller resize timing", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  afterEach(() => {
    vi.stubGlobal("ResizeObserver", originalResizeObserver);
  });

  it("restores the scroll position before a resize callback returns", () => {
    const observers: {
      target: Element;
      callback: ResizeObserverCallback;
    }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          observers.push({ target, callback: this.callback });
        }
        disconnect() {}
      },
    );

    const restore = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup() {
          const engine = provideMessageScroller({ autoScroll: false });
          engine.context.handleResize = restore;
          return () =>
            h(MessageScrollerViewport, null, {
              default: () => h(MessageScrollerContent),
            });
        },
      }),
    );

    expect(observers).toHaveLength(2);
    for (const observer of observers) {
      observer.callback([], {} as ResizeObserver);
      expect(restore).toHaveBeenCalledTimes(observers.indexOf(observer) + 1);
    }
    wrapper.unmount();
  });
});
