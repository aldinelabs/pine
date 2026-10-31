import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import WebControlSettings from "../WebControlSettings.vue";

afterEach(() => vi.restoreAllMocks());

describe("local web access settings", () => {
  it("loads the port, enables access and opens the authenticated browser link", async () => {
    const getWebServer = vi
      .fn()
      .mockResolvedValue({ enabled: false, port: 9415 });
    const setWebServer = vi.fn().mockResolvedValue({
      enabled: true,
      port: 9515,
      url: "http://127.0.0.1:9515/#access_token=secret",
    });
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "window",
      Object.assign(window, {
        pine: { getWebServer, setWebServer, openExternalUrl },
      }),
    );
    const wrapper = mount(WebControlSettings, {
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    await flushPromises();
    await wrapper.get("input").setValue("9515");
    wrapper.getComponent(Switch).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({ enabled: true, port: 9515 });
    const open = wrapper
      .findAll("button")
      .find((button) => button.text() === "在浏览器中打开")!;
    await open.trigger("click");
    expect(openExternalUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:9515/#access_token=secret",
    );
    wrapper.unmount();
  });

  it("keeps a running service visible when changing its port fails", async () => {
    const setWebServer = vi
      .fn()
      .mockRejectedValue(new Error("Address already in use"));
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: {
        getWebServer: () =>
          Promise.resolve({
            enabled: true,
            port: 9415,
            url: "http://127.0.0.1:9415/#access_token=secret",
          }),
        setWebServer,
      },
    });
    const wrapper = mount(WebControlSettings, {
      global: { plugins: [createAppI18n("en-US")] },
    });
    await flushPromises();
    await wrapper.get("input").setValue("9515");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Apply")!
      .trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "Address already in use",
    );
    expect(wrapper.getComponent(Switch).props("modelValue")).toBe(true);
    expect(wrapper.text()).toContain("http://127.0.0.1:9415");
    wrapper.unmount();
  });
});
