import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { handleError } from "@/app/errors/errorHandler";
import ComputerUseEnabledSetting from "../ComputerUseEnabledSetting.vue";

vi.mock("@/app/errors/errorHandler", () => ({ handleError: vi.fn() }));

it("turns Computer Use off", async () => {
  const api = {
    getComputerUseEnabled: vi.fn().mockResolvedValue(true),
    setComputerUseEnabled: vi
      .fn()
      .mockImplementation((request: { enabled: boolean }) =>
        Promise.resolve(request),
      ),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  const wrapper = mount(ComputerUseEnabledSetting, {
    global: { plugins: [createAppI18n("zh-CN")] },
  });
  await flushPromises();
  const toggle = wrapper.get('[data-testid="pine-computer-use-toggle"]');
  expect(toggle.attributes("aria-checked")).toBe("true");
  expect(wrapper.text()).toContain("电脑操作");

  await toggle.trigger("click");
  await flushPromises();
  expect(api.setComputerUseEnabled).toHaveBeenCalledWith({ enabled: false });
  expect(toggle.attributes("aria-checked")).toBe("false");
  wrapper.unmount();
});

it("restores the switch when saving fails", async () => {
  const api = {
    getComputerUseEnabled: vi.fn().mockResolvedValue(false),
    setComputerUseEnabled: vi.fn().mockRejectedValue(new Error("disk full")),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  const wrapper = mount(ComputerUseEnabledSetting, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  await flushPromises();
  const toggle = wrapper.get('[data-testid="pine-computer-use-toggle"]');
  expect(toggle.attributes("aria-checked")).toBe("false");

  await toggle.trigger("click");
  await flushPromises();
  expect(api.setComputerUseEnabled).toHaveBeenCalledWith({ enabled: true });
  expect(toggle.attributes("aria-checked")).toBe("false");
  expect(handleError).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ id: "preferences.computer-use.save-enabled" }),
  );
  wrapper.unmount();
});
