import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MODIFIER_HOLD_DELAY_MS, useModifierHold } from "../useModifierHold";

function mountHold() {
  let held!: ReturnType<typeof useModifierHold>;
  const wrapper = mount(
    defineComponent({
      setup() {
        held = useModifierHold();
        return () => h("div");
      },
    }),
  );
  return { held, wrapper };
}

function key(type: "keydown" | "keyup", key: string) {
  window.dispatchEvent(new KeyboardEvent(type, { key }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("pine", { platform: "darwin" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reveals hints after the modifier is held and hides them on release", () => {
  const { held, wrapper } = mountHold();
  key("keydown", "Meta");
  vi.advanceTimersByTime(MODIFIER_HOLD_DELAY_MS - 1);
  expect(held.value).toBe(false);
  vi.advanceTimersByTime(1);
  expect(held.value).toBe(true);
  key("keyup", "Meta");
  expect(held.value).toBe(false);
  wrapper.unmount();
});

it("stays hidden when the modifier is used for a shortcut", () => {
  const { held, wrapper } = mountHold();
  key("keydown", "Meta");
  key("keydown", "k");
  vi.advanceTimersByTime(MODIFIER_HOLD_DELAY_MS);
  expect(held.value).toBe(false);
  wrapper.unmount();
});

it("hides hints when the window loses focus", () => {
  const { held, wrapper } = mountHold();
  key("keydown", "Meta");
  vi.advanceTimersByTime(MODIFIER_HOLD_DELAY_MS);
  window.dispatchEvent(new Event("blur"));
  expect(held.value).toBe(false);
  wrapper.unmount();
});
