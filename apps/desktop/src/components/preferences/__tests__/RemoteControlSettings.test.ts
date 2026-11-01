import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "vue-sonner";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import RemoteControlSettings from "../RemoteControlSettings.vue";

const running = {
  enabled: true,
  port: 9415,
  url: "http://127.0.0.1:9415/#access_token=secret",
};

function mountWith(pine: Record<string, unknown>, locale = "en-US") {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return mount(RemoteControlSettings, {
    global: { plugins: [createAppI18n(locale as "en-US" | "zh-CN")] },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("remote control settings", () => {
  it("disables the link actions while browser access is off", async () => {
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue({ enabled: false, port: 9415 }),
    });
    await flushPromises();
    for (const id of ["copy", "open"])
      expect(
        wrapper
          .get(`[data-testid="pine-browser-access-${id}"]`)
          .attributes("disabled"),
      ).toBeDefined();
    wrapper.unmount();
  });

  it("turns browser access on and shares the signed-in link", async () => {
    const setWebServer = vi.fn().mockResolvedValue(running);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
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
    expect(wrapper.text()).toContain("正在 http://127.0.0.1:9415 上运行。");

    await wrapper
      .get('[data-testid="pine-browser-access-open"]')
      .trigger("click");
    expect(openExternalUrl).toHaveBeenCalledWith(running.url);
    await wrapper
      .get('[data-testid="pine-browser-access-copy"]')
      .trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(running.url);
    wrapper.unmount();
  });

  it("saves a valid port when the field is committed and rejects out-of-range ports", async () => {
    const setWebServer = vi
      .fn()
      .mockResolvedValue({ ...running, port: 9515, url: "http://x/" });
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue(running),
      setWebServer,
    });
    await flushPromises();
    const port = wrapper.get('[data-testid="pine-browser-access-port"]');

    await port.setValue("80");
    await port.trigger("change");
    expect(setWebServer).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Use a port from 1024 to 65535.");

    await port.setValue("9515");
    await port.trigger("change");
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({ enabled: true, port: 9515 });
    wrapper.unmount();
  });

  it("keeps the running service and explains a port conflict", async () => {
    const error = vi.spyOn(toast, "error");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue(running),
      setWebServer: vi
        .fn()
        .mockRejectedValue(
          new Error("listen EADDRINUSE: address already in use"),
        ),
    });
    await flushPromises();
    const port = wrapper.get('[data-testid="pine-browser-access-port"]');
    await port.setValue("9515");
    await port.trigger("change");
    await flushPromises();
    expect(error).toHaveBeenCalledWith(
      "Unable to update browser access",
      expect.objectContaining({
        description: "Port 9515 is already in use. Choose another port.",
      }),
    );
    expect(wrapper.getComponent(Switch).props("modelValue")).toBe(true);
    expect((port.element as HTMLInputElement).value).toBe("9415");
    wrapper.unmount();
  });
});
