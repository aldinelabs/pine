import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "vue-sonner";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_WEB_SERVER_SETTINGS,
  type WebServerStatus,
} from "@/shared/webControl";
import RemoteControlSettings from "../RemoteControlSettings.vue";

const stopped: WebServerStatus = {
  ...DEFAULT_WEB_SERVER_SETTINGS,
  hasPassword: true,
};
const running: WebServerStatus = {
  ...stopped,
  enabled: true,
  addresses: ["http://127.0.0.1:9415/"],
};

function mountWith(pine: Record<string, unknown>, locale = "en-US") {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return mount(RemoteControlSettings, {
    attachTo: document.body,
    global: { plugins: [createAppI18n(locale as "en-US" | "zh-CN")] },
  });
}

function toggle(wrapper: ReturnType<typeof mountWith>, id: string) {
  return wrapper
    .findAllComponents(Switch)
    .find((component) =>
      component.html().includes(`"pine-browser-access-${id}"`),
    )!;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("remote control settings", () => {
  it("cannot turn browser access on until a password is set", async () => {
    const wrapper = mountWith({
      getWebServer: vi
        .fn()
        .mockResolvedValue({ ...stopped, hasPassword: false }),
    });
    await flushPromises();
    expect(toggle(wrapper, "toggle").props("disabled")).toBe(true);
    expect(wrapper.text()).toContain("Set an access password to turn this on.");
    for (const id of ["copy", "open"])
      expect(
        wrapper
          .get(`[data-testid="pine-browser-access-${id}"]`)
          .attributes("disabled"),
      ).toBeDefined();
    wrapper.unmount();
  });

  it("turns browser access on and opens the local address", async () => {
    const setWebServer = vi.fn().mockResolvedValue(running);
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const wrapper = mountWith(
      {
        getWebServer: vi.fn().mockResolvedValue(stopped),
        setWebServer,
        openExternalUrl,
      },
      "zh-CN",
    );
    await flushPromises();
    toggle(wrapper, "toggle").vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({
      ...DEFAULT_WEB_SERVER_SETTINGS,
      enabled: true,
    });
    expect(wrapper.text()).toContain("正在 http://127.0.0.1:9415/ 上运行。");

    await wrapper
      .get('[data-testid="pine-browser-access-open"]')
      .trigger("click");
    expect(openExternalUrl).toHaveBeenCalledWith("http://127.0.0.1:9415/");
    await wrapper
      .get('[data-testid="pine-browser-access-copy"]')
      .trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:9415/");
    wrapper.unmount();
  });

  it("checks the new password before saving it", async () => {
    const setWebPassword = vi
      .fn()
      .mockResolvedValue({ ...stopped, hasPassword: true });
    const wrapper = mountWith({
      getWebServer: vi
        .fn()
        .mockResolvedValue({ ...stopped, hasPassword: false }),
      setWebPassword,
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-browser-access-password"]')
      .trigger("click");
    await flushPromises();
    const input = (id: string) =>
      document.querySelector<HTMLInputElement>(
        `[data-testid="pine-browser-access-${id}"]`,
      )!;
    const save = () => {
      input("save-password").click();
      return flushPromises();
    };
    const type = (id: string, value: string) => {
      input(id).value = value;
      input(id).dispatchEvent(new Event("input"));
      return flushPromises();
    };

    await type("new-password", "short");
    await type("confirm-password", "short");
    await save();
    expect(document.body.textContent).toContain("Use at least 8 characters.");
    await type("new-password", "long enough");
    await save();
    expect(document.body.textContent).toContain("The passwords don't match.");
    expect(setWebPassword).not.toHaveBeenCalled();
    await type("confirm-password", "long enough");
    await save();
    expect(setWebPassword).toHaveBeenCalledWith("long enough");
    expect(toggle(wrapper, "toggle").props("disabled")).toBe(false);
    wrapper.unmount();
  });

  it("warns before turning the password off, which also turns LAN access off", async () => {
    const setWebServer = vi.fn().mockResolvedValue({
      ...running,
      requirePassword: false,
    });
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue({ ...running, lan: true }),
      setWebServer,
    });
    await flushPromises();
    toggle(wrapper, "require-password").vm.$emit("update:modelValue", false);
    await flushPromises();
    expect(setWebServer).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Turn off the password?");
    expect(document.body.textContent).toContain("Cloudflare Access");
    document
      .querySelector<HTMLElement>(
        '[data-testid="pine-browser-access-confirm-disable-password"]',
      )!
      .click();
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({
      ...DEFAULT_WEB_SERVER_SETTINGS,
      enabled: true,
      requirePassword: false,
      lan: false,
    });
    expect(toggle(wrapper, "lan").props("disabled")).toBe(true);
    expect(wrapper.text()).toContain(
      "Anyone who can reach this address controls Pine without signing in.",
    );
    wrapper.unmount();
  });

  it("saves a public address only when it is a bare origin", async () => {
    const setWebServer = vi.fn().mockResolvedValue({
      ...running,
      publicOrigin: "https://pine.example.com",
    });
    const wrapper = mountWith({
      getWebServer: vi.fn().mockResolvedValue(running),
      setWebServer,
    });
    await flushPromises();
    const origin = wrapper.get('[data-testid="pine-browser-access-origin"]');
    await origin.setValue("https://pine.example.com/app");
    await origin.trigger("change");
    expect(setWebServer).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("without a path");
    await origin.setValue("https://Pine.example.com/");
    await origin.trigger("change");
    await flushPromises();
    expect(setWebServer).toHaveBeenCalledWith({
      ...DEFAULT_WEB_SERVER_SETTINGS,
      enabled: true,
      publicOrigin: "https://pine.example.com",
    });
    wrapper.unmount();
  });

  it("saves a valid port when the field is committed and rejects out-of-range ports", async () => {
    const setWebServer = vi.fn().mockResolvedValue({ ...running, port: 9515 });
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
    expect(setWebServer).toHaveBeenCalledWith({
      ...DEFAULT_WEB_SERVER_SETTINGS,
      enabled: true,
      port: 9515,
    });
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
    expect(toggle(wrapper, "toggle").props("modelValue")).toBe(true);
    expect((port.element as HTMLInputElement).value).toBe("9415");
    wrapper.unmount();
  });
});
