import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_REMOTE_STATUS,
  type RemoteStatus,
} from "@/shared/remoteControl";
import RelayRemoteSettings from "../RelayRemoteSettings.vue";

const device = {
  id: "device-key",
  name: "iPhone",
  pairedAt: Date.UTC(2026, 9, 1),
  online: true,
};
const enabled: RemoteStatus = {
  ...DEFAULT_REMOTE_STATUS,
  enabled: true,
  webAccessOn: true,
};
const pairing: RemoteStatus = {
  ...enabled,
  pairing: {
    url: "https://rc.example.com/#p=abc",
    expiresAt: Date.now() + 5 * 60_000,
    fingerprint: "AB12 CD34",
  },
};

function mountWith(pine: Record<string, unknown>, locale = "en-US") {
  Object.defineProperty(window, "pine", { configurable: true, value: pine });
  return mount(RelayRemoteSettings, {
    attachTo: document.body,
    global: { plugins: [createAppI18n(locale as "en-US" | "zh-CN")] },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("relay remote settings", () => {
  it("turns Remote Control on", async () => {
    const setRemoteControlEnabled = vi.fn().mockResolvedValue(enabled);
    const wrapper = mountWith({
      getRemoteControl: vi.fn().mockResolvedValue(DEFAULT_REMOTE_STATUS),
      setRemoteControlEnabled,
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="pine-relay-remote-pair"]').exists(),
    ).toBe(false);
    wrapper.getComponent(Switch).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setRemoteControlEnabled).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain("No devices are paired yet.");
    wrapper.unmount();
  });

  it("asks for browser access before a device can pair", async () => {
    const wrapper = mountWith({
      getRemoteControl: vi
        .fn()
        .mockResolvedValue({ ...enabled, webAccessOn: false }),
    });
    await flushPromises();
    expect(
      wrapper.find('[data-testid="pine-relay-remote-needs-web"]').exists(),
    ).toBe(true);
    expect(
      wrapper
        .get('[data-testid="pine-relay-remote-pair"]')
        .attributes("disabled"),
    ).toBeDefined();
    wrapper.unmount();
  });

  it("shows a QR code and cancels it when the dialog closes", async () => {
    const cancelRemotePairing = vi.fn().mockResolvedValue(enabled);
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const wrapper = mountWith({
      getRemoteControl: vi.fn().mockResolvedValue(enabled),
      startRemotePairing: vi.fn().mockResolvedValue(pairing),
      cancelRemotePairing,
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-relay-remote-pair"]')
      .trigger("click");
    await flushPromises();
    const qr = document.querySelector('[data-testid="pine-relay-remote-qr"]');
    expect(qr?.querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
    expect(document.body.textContent).toContain("AB12 CD34");
    expect(
      (
        document.querySelector(
          '[data-testid="pine-relay-remote-link"]',
        ) as HTMLInputElement
      ).value,
    ).toBe(pairing.pairing!.url);
    (
      document.querySelector(
        '[data-testid="pine-relay-remote-copy"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(pairing.pairing!.url);

    (
      document.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(cancelRemotePairing).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("closes the QR code once a device has paired", async () => {
    let push: ((status: RemoteStatus) => void) | undefined;
    const wrapper = mountWith({
      getRemoteControl: vi.fn().mockResolvedValue(enabled),
      startRemotePairing: vi.fn().mockResolvedValue(pairing),
      cancelRemotePairing: vi.fn().mockResolvedValue(enabled),
      onRemoteControlChanged: (listener: (status: RemoteStatus) => void) => {
        push = listener;
        return () => undefined;
      },
    });
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-relay-remote-pair"]')
      .trigger("click");
    await flushPromises();
    expect(
      document.querySelector('[data-testid="pine-relay-remote-qr"]'),
    ).not.toBeNull();
    push!({ ...enabled, devices: [device] });
    await flushPromises();
    expect(
      document.querySelector('[data-testid="pine-relay-remote-qr"]'),
    ).toBeNull();
    expect(wrapper.text()).toContain("iPhone");
    expect(wrapper.text()).toContain("Online");
    wrapper.unmount();
  });

  it("renames and removes a paired device", async () => {
    const renameRemoteDevice = vi.fn().mockResolvedValue({
      ...enabled,
      devices: [{ ...device, name: "Work" }],
    });
    const removeRemoteDevice = vi.fn().mockResolvedValue(enabled);
    const wrapper = mountWith(
      {
        getRemoteControl: vi
          .fn()
          .mockResolvedValue({ ...enabled, devices: [device] }),
        renameRemoteDevice,
        removeRemoteDevice,
      },
      "zh-CN",
    );
    await flushPromises();
    await wrapper
      .get('[data-testid="pine-relay-remote-rename"]')
      .trigger("click");
    await flushPromises();
    const input = document.querySelector(
      '[data-testid="pine-relay-remote-name"]',
    ) as HTMLInputElement;
    input.value = "  Work ";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    (input.form as HTMLFormElement).requestSubmit();
    await flushPromises();
    expect(renameRemoteDevice).toHaveBeenCalledWith({
      id: "device-key",
      name: "Work",
    });

    await wrapper
      .get('[data-testid="pine-relay-remote-remove"]')
      .trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("移除“Work”？");
    (
      document.querySelector(
        '[data-testid="pine-relay-remote-confirm-remove"]',
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(removeRemoteDevice).toHaveBeenCalledWith("device-key");
    expect(wrapper.text()).toContain("还没有配对的设备。");
    wrapper.unmount();
  });
});
