import { mount } from "@vue/test-utils";
import { afterEach, expect, it } from "vitest";
import DialogScrollArea from "../DialogScrollArea.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

it("places the overlay outside the content without reserving a native scrollbar gutter", () => {
  const wrapper = mount(DialogScrollArea, {
    props: { class: "max-h-72" },
    slots: { default: "Content" },
  });
  wrappers.push(wrapper);
  const root = wrapper.get('[data-slot="dialog-scroll-area"]');
  expect(root.attributes("style")).toContain("--dialog-scroll-edge: 1.25rem");
  expect(root.attributes("style")).toContain(
    "margin-inline-end: calc(-1 * var(--dialog-scroll-edge))",
  );
  const viewport = wrapper.get('[data-slot="scroll-area-viewport"]');
  expect(viewport.classes()).toContain("max-h-[inherit]");
  expect(viewport.attributes("data-reka-scroll-area-viewport")).toBeDefined();
  expect(
    wrapper.get('[data-slot="dialog-scroll-area-content"]').attributes("style"),
  ).toContain("padding-inline-end: 1.25rem");
  expect(root.classes()).not.toContain("pr-4");
  expect(root.classes()).not.toContain("overflow-y-auto");
});

it("keeps content padding when the thumb sits at a flush pane edge", () => {
  const wrapper = mount(DialogScrollArea, {
    props: { edgeInset: "0rem", contentInset: "1.25rem", contentClass: "px-5" },
    slots: { default: "Content" },
  });
  wrappers.push(wrapper);
  const content = wrapper.get('[data-slot="dialog-scroll-area-content"]');
  expect(content.attributes("style")).toContain("padding-inline-end: 1.25rem");
  expect(content.classes()).toContain("px-5");
  expect(
    wrapper.get('[data-slot="dialog-scroll-area"]').attributes("style"),
  ).toContain("--dialog-scroll-edge: 0rem");
});

it("exposes the actual viewport and forwards scroll events for log tail-following", async () => {
  const wrapper = mount(DialogScrollArea, {
    props: { edgeInset: "0rem", viewportClass: "max-h-24" },
  });
  wrappers.push(wrapper);
  const viewport = wrapper.get<HTMLElement>(
    '[data-slot="scroll-area-viewport"]',
  );
  expect(wrapper.vm.viewport).toBe(viewport.element);
  expect(viewport.classes()).toContain("max-h-24");
  expect(viewport.classes()).not.toContain("max-h-[inherit]");
  viewport.element.scrollTop = 100;
  await viewport.trigger("scroll");
  expect(wrapper.emitted("scroll")).toHaveLength(1);
  expect(wrapper.vm.viewport?.scrollTop).toBe(100);
});
