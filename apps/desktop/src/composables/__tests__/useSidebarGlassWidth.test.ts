import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, ref, useTemplateRef } from "vue";
import { useSidebarGlassWidth } from "../useSidebarGlassWidth";
import { useAppearanceStore } from "@/stores/appearance";

const setSidebarGlassWidth = vi.fn();

beforeEach(() => {
  setActivePinia(createPinia());
  setSidebarGlassWidth.mockClear();
  vi.stubGlobal("pine", { setSidebarGlassWidth });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        right: this.dataset.slot === "sidebar-container" ? 256 : 0,
      } as DOMRect;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports the column again when a narrow window gives it back", async () => {
  useAppearanceStore().sidebarVibrancy = true;
  // Like the sidebar: a column on a wide window, a sheet elsewhere on a
  // narrow one, under the same component.
  const narrow = ref(false);
  const Host = defineComponent({
    setup() {
      const root = useTemplateRef<HTMLElement>("root");
      useSidebarGlassWidth(() => {
        void narrow.value;
        return root.value ?? undefined;
      });
      return () =>
        h("div", { ref: "root" }, [
          narrow.value
            ? h("div", { "data-slot": "sheet" })
            : h("div", { "data-slot": "sidebar-container" }),
        ]);
    },
  });
  const wrapper = mount(Host);
  await flushPromises();
  expect(setSidebarGlassWidth).toHaveBeenLastCalledWith(256);

  narrow.value = true;
  await flushPromises();
  expect(setSidebarGlassWidth).toHaveBeenLastCalledWith(0);

  narrow.value = false;
  await flushPromises();
  expect(setSidebarGlassWidth).toHaveBeenLastCalledWith(256);
  wrapper.unmount();
});
