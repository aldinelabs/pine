import { mount } from "@vue/test-utils";
import { defineComponent, onUnmounted } from "vue";
import { expect, it, vi } from "vitest";
import RetainedPanel from "../RetainedPanel.vue";

it("mounts lazily and retains connected, measurable content until closed", async () => {
  const mounted = vi.fn();
  const unmounted = vi.fn();
  const Content = defineComponent({
    setup() {
      mounted();
      onUnmounted(unmounted);
    },
    template: "<div data-scroll><textarea /></div>",
  });
  const wrapper = mount(RetainedPanel, {
    props: { active: false },
    slots: { default: Content },
    attachTo: document.body,
  });
  expect(mounted).not.toHaveBeenCalled();
  await wrapper.setProps({ active: true });
  const scroller = wrapper.get<HTMLElement>("[data-scroll]").element;
  scroller.scrollTop = 320;
  scroller.scrollLeft = 75;
  await wrapper.get("textarea").setValue("unfinished draft");

  await wrapper.setProps({ active: false });
  expect(scroller.isConnected).toBe(true);
  expect(wrapper.element.inert).toBe(true);
  expect(wrapper.attributes("aria-hidden")).toBe("true");
  expect(wrapper.element.style.visibility).toBe("hidden");
  // Root opacity suppresses children whose transition-all delays visibility.
  expect(wrapper.element.style.opacity).toBe("0");
  // Hidden panels skip rendering work but keep their layout state.
  expect(wrapper.element.style.contentVisibility).toBe("hidden");
  expect(wrapper.element.style.display).not.toBe("none");
  expect(wrapper.attributes("hidden")).toBeUndefined();

  await wrapper.setProps({ active: true });
  expect(wrapper.get("[data-scroll]").element).toBe(scroller);
  expect(scroller.scrollTop).toBe(320);
  expect(scroller.scrollLeft).toBe(75);
  expect(wrapper.get("textarea").element.value).toBe("unfinished draft");
  expect(wrapper.element.inert).toBe(false);
  expect(wrapper.attributes("aria-hidden")).toBeUndefined();
  expect(wrapper.element.style.opacity).toBe("");
  expect(wrapper.element.style.contentVisibility).toBe("");
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  wrapper.unmount();
  expect(unmounted).toHaveBeenCalledTimes(1);
});
