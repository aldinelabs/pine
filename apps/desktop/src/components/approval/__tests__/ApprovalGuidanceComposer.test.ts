import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ApprovalGuidanceComposer from "../ApprovalGuidanceComposer.vue";

enableAutoUnmount(afterEach);

function mountComposer(modelValue = "", disabled = false) {
  const wrapper = mount(ApprovalGuidanceComposer, {
    props: {
      modelValue,
      disabled,
      "onUpdate:modelValue": (value: string) =>
        wrapper.setProps({ modelValue: value }),
    },
    attachTo: document.body,
    global: { plugins: [createAppI18n("zh-CN")] },
  });
  return wrapper;
}

function pressKey(element: Element, options: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  element.dispatchEvent(event);
  return event;
}

describe("ApprovalGuidanceComposer", () => {
  it("focuses the multiline input and submits trimmed guidance with Enter", async () => {
    const wrapper = mountComposer();
    const input = wrapper.get("textarea");
    expect(document.activeElement).toBe(input.element);
    expect(input.attributes("aria-label")).toBe("拒绝并说明要求");
    await input.setValue("  请改用只读命令\n不要修改文件  ");

    const newline = pressKey(input.element, { key: "Enter", shiftKey: true });
    expect(newline.defaultPrevented).toBe(false);
    expect(wrapper.emitted("submit")).toBeUndefined();

    const submit = pressKey(input.element, { key: "Enter" });
    expect(submit.defaultPrevented).toBe(true);
    expect(wrapper.emitted("submit")).toEqual([
      ["请改用只读命令\n不要修改文件"],
    ]);
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "leaves IME confirmation keys alone (%j)",
    (options) => {
      const wrapper = mountComposer("请先说明");
      const input = wrapper.get("textarea");
      for (const key of ["Enter", "Escape"]) {
        const event = pressKey(input.element, { key, ...options });
        expect(event.defaultPrevented).toBe(false);
      }
      expect(wrapper.emitted("submit")).toBeUndefined();
      expect(wrapper.emitted("cancel")).toBeUndefined();

      pressKey(input.element, { key: "Enter" });
      expect(wrapper.emitted("submit")).toEqual([["请先说明"]]);
    },
  );

  it("waits for composition to end and submits the committed text on the next Enter", async () => {
    const wrapper = mountComposer("请");
    const input = wrapper.get("textarea");
    await input.trigger("compositionstart");
    input.element.value = "请先说明";
    await input.trigger("input");

    const accepting = pressKey(input.element, { key: "Enter" });
    expect(accepting.defaultPrevented).toBe(false);
    expect(wrapper.emitted("submit")).toBeUndefined();
    await input.trigger("compositionend");

    pressKey(input.element, { key: "Enter" });
    expect(wrapper.emitted("submit")).toEqual([["请先说明"]]);
  });

  it("blocks blank or pending submissions through both keyboard and button", async () => {
    const wrapper = mountComposer("  \n  ");
    const input = wrapper.get("textarea");
    expect(wrapper.get("button").attributes("disabled")).toBeDefined();
    pressKey(input.element, { key: "Enter" });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await input.setValue("Use a read-only command");
    await wrapper.setProps({ disabled: true });
    expect(input.attributes("disabled")).toBeDefined();
    pressKey(input.element, { key: "Enter" });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("submit")).toBeUndefined();

    await wrapper.setProps({ disabled: false });
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("submit")).toEqual([["Use a read-only command"]]);
  });

  it("ignores modified or repeated Enter and lets Escape return to the decisions", () => {
    const wrapper = mountComposer("Use a read-only command");
    const input = wrapper.get("textarea").element;
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { repeat: true },
    ]) {
      pressKey(input, { key: "Enter", ...options });
    }
    expect(wrapper.emitted("submit")).toBeUndefined();

    const cancel = pressKey(input, { key: "Escape" });
    expect(cancel.defaultPrevented).toBe(true);
    expect(wrapper.emitted("cancel")).toEqual([[]]);
  });
});
