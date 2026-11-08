import { mount } from "@vue/test-utils";
import { h } from "vue";
import { expect, it } from "vitest";
import MessageScrollerProvider from "../MessageScrollerProvider.vue";
import MessageScrollerViewport from "../MessageScrollerViewport.vue";

it("keeps horizontal swipes from releasing the transcript tail, and still detects vertical scrolling", async () => {
  const wrapper = mount(MessageScrollerProvider, {
    slots: { default: () => h(MessageScrollerViewport) },
  });
  const viewport = wrapper.getComponent(MessageScrollerViewport);
  const touch = (x: number, y: number) => ({
    touches: [{ clientX: x, clientY: y }],
  });
  await viewport.trigger("touchstart", touch(150, 100));
  await viewport.trigger("touchmove", touch(120, 103));
  await viewport.trigger("touchmove", touch(80, 115));
  expect(viewport.emitted("userScrollIntent")).toBeUndefined();
  await viewport.trigger("touchend", { touches: [] });
  await viewport.trigger("touchstart", touch(100, 100));
  await viewport.trigger("touchmove", touch(102, 103));
  expect(viewport.emitted("userScrollIntent")).toBeUndefined();
  await viewport.trigger("touchmove", touch(103, 130));
  expect(viewport.emitted("userScrollIntent")).toHaveLength(1);
  wrapper.unmount();
});
