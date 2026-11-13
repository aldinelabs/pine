import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Switch } from "@/components/ui/switch";
import type { RemoteKeepAwakeStatus } from "@/shared/remoteKeepAwake";
import RemoteKeepAwakeSettings from "../RemoteKeepAwakeSettings.vue";

type Listener = (status: RemoteKeepAwakeStatus) => void;

function mountWith(pine: Record<string, unknown>) {
  let push: Listener | undefined;
  const stop = vi.fn();
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      onRemoteKeepAwakeChanged: (listener: Listener) => {
        push = listener;
        return stop;
      },
      ...pine,
    },
  });
  const wrapper = mount(RemoteKeepAwakeSettings, {
    attachTo: document.body,
    global: { plugins: [createAppI18n("en-US")] },
  });
  return {
    wrapper,
    stop,
    push: async (status: RemoteKeepAwakeStatus) => {
      push!(status);
      await flushPromises();
    },
  };
}

function toggle(wrapper: VueWrapper) {
  const found = wrapper
    .findAllComponents(Switch)
    .find(
      (candidate) =>
        candidate.vm.$attrs["data-testid"] === "pine-remote-keep-awake",
    );
  if (!found) throw new Error("Missing switch");
  return found;
}

const idle = () =>
  document.querySelector('[data-testid="pine-remote-keep-awake-idle"]');

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RemoteKeepAwakeSettings", () => {
  it("loads the status into the switch and saves a change", async () => {
    const setRemoteKeepAwake = vi
      .fn()
      .mockResolvedValue({ enabled: true, remoteOn: true });
    const { wrapper } = mountWith({
      getRemoteKeepAwake: vi
        .fn()
        .mockResolvedValue({ enabled: false, remoteOn: true }),
      setRemoteKeepAwake,
    });
    await flushPromises();
    expect(wrapper.text()).toContain(
      "Keep the computer awake while remote control is on",
    );
    expect(toggle(wrapper).props("modelValue")).toBe(false);
    expect(toggle(wrapper).props("disabled")).toBe(false);

    toggle(wrapper).vm.$emit("update:modelValue", true);
    await flushPromises();
    expect(setRemoteKeepAwake).toHaveBeenCalledWith(true);
    expect(toggle(wrapper).props("modelValue")).toBe(true);
    wrapper.unmount();
  });

  it("says the computer sleeps as usual only while on with no remote on", async () => {
    const { wrapper, push } = mountWith({
      getRemoteKeepAwake: vi
        .fn()
        .mockResolvedValue({ enabled: true, remoteOn: false }),
    });
    await flushPromises();
    expect(idle()?.textContent).toContain("sleeps as usual");

    await push({ enabled: true, remoteOn: true });
    expect(idle()).toBeNull();
    await push({ enabled: false, remoteOn: false });
    expect(idle()).toBeNull();
    expect(toggle(wrapper).props("modelValue")).toBe(false);
    wrapper.unmount();
  });

  it("follows changes made elsewhere and stops listening on unmount", async () => {
    const { wrapper, push, stop } = mountWith({
      getRemoteKeepAwake: vi
        .fn()
        .mockResolvedValue({ enabled: false, remoteOn: false }),
    });
    await flushPromises();
    await push({ enabled: true, remoteOn: true });
    expect(toggle(wrapper).props("modelValue")).toBe(true);
    wrapper.unmount();
    expect(stop).toHaveBeenCalledOnce();
  });
});
