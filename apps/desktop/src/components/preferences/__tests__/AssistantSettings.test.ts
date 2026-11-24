import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantSettings as Settings,
} from "@/shared/assistant";
import AssistantSettings from "../AssistantSettings.vue";

function install(session?: { id: string }) {
  const api = {
    getAssistant: vi.fn().mockResolvedValue({
      settings: { ...DEFAULT_ASSISTANT_SETTINGS },
      ...(session
        ? {
            session: {
              ...session,
              createdAt: "c",
              updatedAt: "u",
              messageCount: 2,
            },
          }
        : {}),
    }),
    setAssistantSettings: vi
      .fn()
      .mockImplementation((next: Settings) => Promise.resolve(next)),
    clearAssistant: vi.fn().mockResolvedValue({ cleared: true }),
    getModelCatalog: vi.fn().mockRejectedValue(new Error("offline")),
  };
  Object.defineProperty(window, "pine", { configurable: true, value: api });
  setActivePinia(createPinia());
  const wrapper = mount(AssistantSettings, {
    attachTo: document.body,
    global: {
      plugins: [createAppI18n("zh-CN")],
      stubs: { MemoryManagerDialog: true },
    },
  });
  return { api, wrapper };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Settings › Assistant", () => {
  it("lets reports wake the Assistant", async () => {
    const { api, wrapper } = install();
    await flushPromises();

    const toggle = wrapper.get('[data-testid="pine-assistant-wakes"]');
    expect(toggle.attributes("aria-checked")).toBe("false");
    await toggle.trigger("click");
    await flushPromises();

    expect(api.setAssistantSettings).toHaveBeenCalledWith({
      ...DEFAULT_ASSISTANT_SETTINGS,
      wakesOnReport: true,
    });
    expect(toggle.attributes("aria-checked")).toBe("true");
    wrapper.unmount();
  });

  it("has nothing to clear before the first conversation", async () => {
    const { wrapper } = install();
    await flushPromises();

    expect(
      wrapper.get('[data-testid="pine-assistant-clear"]').attributes(),
    ).toHaveProperty("disabled");
    wrapper.unmount();
  });

  it("clears the conversation only once confirmed", async () => {
    const { api, wrapper } = install({ id: "s1" });
    await flushPromises();

    await wrapper.get('[data-testid="pine-assistant-clear"]').trigger("click");
    await flushPromises();
    expect(api.clearAssistant).not.toHaveBeenCalled();
    const confirm = document.body.querySelector<HTMLElement>(
      '[data-testid="pine-assistant-clear-confirm"]',
    );
    expect(confirm).not.toBeNull();
    confirm?.click();
    await flushPromises();

    expect(api.clearAssistant).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
