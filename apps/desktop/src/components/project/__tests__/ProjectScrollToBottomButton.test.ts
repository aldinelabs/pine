import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { MessageScrollerScrollable } from "@/components/ui/message-scroller";
import ProjectScrollToBottomButton, {
  showsScrollToBottom,
} from "../ProjectScrollToBottomButton.vue";

const followingBottom = shallowRef(false);
const scrollable = shallowRef<MessageScrollerScrollable>({
  start: true,
  end: true,
});
const scrollToEnd = vi.fn();

vi.mock("@/components/ui/message-scroller/useMessageScroller", () => ({
  useMessageScrollerContext: () => ({
    followingBottom,
    scrollable,
    scrollToEnd,
  }),
}));

describe("showsScrollToBottom", () => {
  it("shows a viewport height away, at least 400px, and hides below half", () => {
    expect(showsScrollToBottom(399, 300, false)).toBe(false);
    expect(showsScrollToBottom(400, 300, false)).toBe(true);
    expect(showsScrollToBottom(799, 800, false)).toBe(false);
    expect(showsScrollToBottom(800, 800, false)).toBe(true);
    // Once shown, it stays until the reader is back within half of that.
    expect(showsScrollToBottom(500, 800, true)).toBe(true);
    expect(showsScrollToBottom(399, 800, true)).toBe(false);
  });
});

/** The button beside a 600px viewport over `height()` px of content. */
function mountButton(height: () => number) {
  const Host = defineComponent({
    setup: () => () =>
      h("div", [
        h("div", { "data-slot": "message-scroller-viewport" }),
        h(ProjectScrollToBottomButton),
      ]),
  });
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
  });
  const viewport = wrapper.get('[data-slot="message-scroller-viewport"]')
    .element as HTMLElement;
  Object.defineProperties(viewport, {
    clientHeight: { get: () => 600 },
    scrollHeight: { get: height },
  });
  const button = () => wrapper.get('[data-slot="scroll-to-bottom-button"]');
  const scrollTo = async (top: number) => {
    viewport.scrollTop = top;
    viewport.dispatchEvent(new Event("scroll"));
    await nextTick();
  };
  return { wrapper, viewport, button, scrollTo };
}

describe("ProjectScrollToBottomButton", () => {
  it("appears only well above the bottom and scrolls back on click", async () => {
    followingBottom.value = false;
    const { wrapper, button, scrollTo } = mountButton(() => 3000);
    expect(button().text()).toBe("Scroll to bottom");
    expect(button().attributes("data-active")).toBe("false");

    // 300px above the bottom: away from it, but not far enough.
    await scrollTo(2100);
    expect(button().attributes("data-active")).toBe("false");

    await scrollTo(1800);
    expect(button().attributes("data-active")).toBe("true");
    expect(button().attributes("tabindex")).toBeUndefined();

    // Halfway back it stays; closer than half a viewport it goes.
    await scrollTo(2000);
    expect(button().attributes("data-active")).toBe("true");
    await scrollTo(2150);
    expect(button().attributes("data-active")).toBe("false");

    await scrollTo(1000);
    await button().trigger("click");
    expect(scrollToEnd).toHaveBeenCalledWith({ behavior: "smooth" });
    wrapper.unmount();
  });

  it("does not pop in as a reply grows below a reader resting near the bottom", async () => {
    followingBottom.value = false;
    let height = 3000;
    const { wrapper, button, scrollTo } = mountButton(() => height);
    await scrollTo(2300);
    height = 6000;
    await nextTick();
    expect(button().attributes("data-active")).toBe("false");
    wrapper.unmount();
  });

  it("hides as soon as the transcript follows the bottom again", async () => {
    followingBottom.value = false;
    const { wrapper, button, scrollTo } = mountButton(() => 3000);
    await scrollTo(0);
    expect(button().attributes("data-active")).toBe("true");

    followingBottom.value = true;
    await nextTick();
    expect(button().attributes("data-active")).toBe("false");
    wrapper.unmount();
  });
});
