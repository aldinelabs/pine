import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  type PineAutoApprovalSettings,
} from "@/shared/preferences";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { useModelsStore } from "@/stores/models";
import AutoApprovalSettings from "../AutoApprovalSettings.vue";
import DecisionsModelSettings from "../DecisionsModelSettings.vue";
import { defineComponent } from "vue";

vi.mock("@/app/errors/errorHandler", () => ({ handleError: vi.fn() }));
const getSettings = vi.fn();
const setSettings = vi.fn();
const originalPine = window.pine;
const modelPickerStub = {
  props: ["open", "purpose"],
  template:
    '<div data-model-picker :data-open="open" :data-purpose="purpose" />',
};

function mountSettings(locale: "zh-CN" | "en-US" = "zh-CN") {
  const pinia = createPinia();
  const wrapper = mount(
    defineComponent({
      components: { AutoApprovalSettings, DecisionsModelSettings },
      template: "<div><DecisionsModelSettings /><AutoApprovalSettings /></div>",
    }),
    {
      global: {
        plugins: [pinia, createAppI18n(locale)],
        stubs: { ModelPickerDialog: modelPickerStub },
      },
    },
  );
  return {
    wrapper,
    store: useAutoApprovalStore(pinia),
    models: useModelsStore(pinia),
  };
}

beforeEach(() => {
  getSettings
    .mockReset()
    .mockResolvedValue({ ...DEFAULT_AUTO_APPROVAL_SETTINGS });
  setSettings
    .mockReset()
    .mockImplementation((settings) => Promise.resolve(settings));
  window.pine = {
    getAutoApprovalSettings: getSettings,
    setAutoApprovalSettings: setSettings,
  } as unknown as typeof window.pine;
});
afterEach(() => {
  window.pine = originalPine;
});

describe("automatic approval preferences", () => {
  it("defaults to Decisions screening without a threshold setting", async () => {
    const { wrapper, store } = mountSettings();
    await flushPromises();
    expect(store.settings.strategy).toBe("decisions");
    expect(wrapper.getComponent(ToggleGroup).text()).toContain("基于决策模型");
    expect(wrapper.find('[role="slider"]').exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(store.settings).not.toHaveProperty("confidenceThreshold");
  });

  it("loads saved settings and opens the Decisions catalog with credential guidance", async () => {
    getSettings.mockResolvedValue({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
    });
    const { wrapper, models } = mountSettings();
    await flushPromises();
    expect(wrapper.text()).toContain("尚未配置 OpenRouter");
    models.catalog = {
      models: [],
      decisionsModels: [
        {
          id: "typesafe/jev-1.13",
          name: "Jev 1.13",
          providerId: "openrouter",
          providerName: "OpenRouter",
        },
      ],
      providers: [
        {
          id: "openrouter",
          name: "OpenRouter",
          configured: true,
          authMethods: [],
          modelCount: 0,
        },
      ],
    };
    await flushPromises();
    expect(wrapper.text()).toContain("Jev 1.13");
    await wrapper
      .get('[data-testid="pine-decisions-model-button"]')
      .trigger("click");
    expect(wrapper.get("[data-model-picker]").attributes("data-purpose")).toBe(
      "decisions",
    );
    expect(wrapper.get("[data-model-picker]").attributes("data-open")).toBe(
      "true",
    );
  });

  it("switches paths while preserving the selected Decisions model", async () => {
    const { wrapper, store } = mountSettings();
    await flushPromises();
    wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", "model");
    await flushPromises();
    expect(setSettings).toHaveBeenLastCalledWith({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      strategy: "model",
    });
    expect(store.settings.decisionsModel).toBe("typesafe/jev-1.13");
    expect(
      wrapper
        .get('[data-testid="pine-decisions-model-button"]')
        .attributes("disabled"),
    ).toBeDefined();
    wrapper
      .getComponent(ToggleGroup)
      .vm.$emit("update:modelValue", "decisions");
    await flushPromises();
    expect(
      wrapper
        .get('[data-testid="pine-decisions-model-button"]')
        .attributes("disabled"),
    ).toBeUndefined();
  });

  it("ignores invalid or unchanged toggle values", async () => {
    const { wrapper } = mountSettings();
    await flushPromises();
    for (const value of ["", "unknown", "decisions"]) {
      wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", value);
    }
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("locks controls during save and preserves the saved path on failure", async () => {
    let rejectSave!: (error: Error) => void;
    setSettings.mockImplementation(
      () =>
        new Promise<PineAutoApprovalSettings>((_, reject) => {
          rejectSave = reject;
        }),
    );
    const { wrapper, store } = mountSettings();
    await flushPromises();
    wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", "model");
    await flushPromises();
    expect(wrapper.getComponent(ToggleGroup).props("disabled")).toBe(true);
    rejectSave(new Error("Disk unavailable"));
    await flushPromises();
    expect(store.settings.strategy).toBe("decisions");
    expect(wrapper.getComponent(ToggleGroup).props("disabled")).toBe(false);
  });

  it("does not overwrite saved settings after a load failure", async () => {
    getSettings.mockRejectedValue(new Error("IPC unavailable"));
    const { wrapper } = mountSettings();
    await flushPromises();
    expect(wrapper.getComponent(ToggleGroup).props("disabled")).toBe(true);
    wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", "model");
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("supports English and restores settings on reopening", async () => {
    const { wrapper } = mountSettings("en-US");
    await flushPromises();
    expect(wrapper.text()).toContain("Automatic approval path");
    expect(wrapper.getComponent(ToggleGroup).text()).toContain(
      "Decision model",
    );
    wrapper.unmount();
    getSettings.mockResolvedValue({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      strategy: "model",
    });
    const reopened = mountSettings("en-US");
    await flushPromises();
    expect(reopened.wrapper.text()).toContain("Automatic approval path");
    expect(reopened.store.settings.strategy).toBe("model");
    expect(reopened.wrapper.find('[role="slider"]').exists()).toBe(false);
  });
});
