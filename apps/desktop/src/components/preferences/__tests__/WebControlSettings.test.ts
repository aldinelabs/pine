import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import WebControlSettings from "../WebControlSettings.vue";

const runningStatus = {
  enabled: true,
  port: 9415,
  url: "http://127.0.0.1:9415/#access_token=secret",
};

function mountWith(pine: Record<string, unknown>, locale = "en-US") {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return mount(WebControlSettings, {
    global: { plugins: [createAppI18n(locale as "en-US" | "zh-CN")] },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("browser access settings", () => {
  it("keeps details hidden while access is off", async () => {
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue({ enabled: false, port: 9415 }),
    });
    await flushPromises();
    expect(wrapper.find('[data-testid="web-control-details"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("turns access on and offers the signed-in link", async () => {
    const setWebServer = vi.fn().mockResolvedValue(runningStatus);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    const wrapper = mountWith(
      {
        getWebServer: vi.fn().mockResolvedValue({ enabled: false, port: 9415 }),
        setWebServer,
        openExternalUrl,
      },
      "zh-CN",
    );
    await flushPromises();
    wrapper.getComponent(Switch).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({ enabled: true, port: 9415 });
    expect(wrapper.get('[data-testid="web-control-address"]').text()).toBe(
      "http://127.0.0.1:9415",
    );

    await wrapper.get('[data-testid="web-control-open"]').trigger("click");
    expect(openExternalUrl).toHaveBeenCalledWith(runningStatus.url);
    await wrapper.get('[data-testid="web-control-copy"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(runningStatus.url);
    expect(wrapper.get('[data-testid="web-control-copy"]').text()).toBe(
      "已复制",
    );
    wrapper.unmount();
  });

  it("shows Apply only for a changed port and validates the range", async () => {
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue(runningStatus),
    });
    await flushPromises();
    const apply = () =>
      wrapper.find('[data-testid="web-control-apply-port"]').exists();
    expect(apply()).toBe(false);
    await wrapper.get("#pine-web-port").setValue("80");
    expect(apply()).toBe(true);
    expect(wrapper.text()).toContain("Use a port from 1024 to 65535.");
    wrapper.unmount();
  });

  it("keeps the running service visible when changing its port fails", async () => {
    const setWebServer = vi
      .fn()
      .mockRejectedValue(new Error("Address already in use"));
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue(runningStatus),
      setWebServer,
    });
    await flushPromises();
    await wrapper.get("#pine-web-port").setValue("9515");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({ enabled: true, port: 9515 });
    expect(wrapper.get('[data-testid="web-control-error"]').text()).toContain(
      "Address already in use",
    );
    expect(wrapper.getComponent(Switch).props("modelValue")).toBe(true);
    expect(wrapper.get('[data-testid="web-control-address"]').text()).toBe(
      "http://127.0.0.1:9415",
    );
    wrapper.unmount();
  });
});
