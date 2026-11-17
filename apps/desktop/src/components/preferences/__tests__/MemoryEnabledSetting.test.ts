import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import MemoryEnabledSetting from "../MemoryEnabledSetting.vue";

it("turns memory off", async () => {
  const api = {
    getMemoryEnabled: vi.fn().mockResolvedValue(true),
    setMemoryEnabled: vi
      .fn()
      .mockImplementation((request: { enabled: boolean }) =>
        Promise.resolve(request),
      ),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  const wrapper = mount(MemoryEnabledSetting, {
    global: { plugins: [createAppI18n("zh-CN")] },
  });
  await flushPromises();
  const toggle = wrapper.get('[data-testid="pine-memory-toggle"]');
  expect(toggle.attributes("aria-checked")).toBe("true");
  expect(wrapper.text()).toContain("更多功能 › 记忆");

  await toggle.trigger("click");
  await flushPromises();
  expect(api.setMemoryEnabled).toHaveBeenCalledWith({ enabled: false });
  expect(toggle.attributes("aria-checked")).toBe("false");
  wrapper.unmount();
});
