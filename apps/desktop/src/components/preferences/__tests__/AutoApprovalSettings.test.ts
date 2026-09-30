import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  type PineAutoApprovalSettings,
} from "@/shared/preferences";
import { useAutoApprovalStore } from "@/stores/autoApproval";
import { useModelsStore } from "@/stores/models";
import AutoApprovalSettings from "../AutoApprovalSettings.vue";

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
  const wrapper = mount(AutoApprovalSettings, {
    global: {
      plugins: [pinia, createAppI18n(locale)],
      stubs: { ModelPickerDialog: modelPickerStub },
    },
  });
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
  it("defaults to Decisions screening with a 66% slider", async () => {
    const { wrapper, store } = mountSettings();
    await flushPromises();
    expect(store.settings.strategy).toBe("decisions");
    expect(wrapper.getComponent(Slider).props("modelValue")).toEqual([66]);
    expect(
      wrapper.get('[data-testid="pine-decisions-threshold-value"]').text(),
    ).toBe("66%");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.get('[role="slider"]').attributes("aria-labelledby")).toBe(
      "pine-decisions-threshold-label",
    );
    expect(wrapper.get('[role="slider"]').attributes("aria-valuetext")).toBe(
      "66%",
    );
  });

  it("loads saved settings and opens the Decisions catalog with credential guidance", async () => {
    getSettings.mockResolvedValue({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      confidenceThreshold: 0.95,
    });
    const { wrapper, models } = mountSettings();
    await flushPromises();
    expect(wrapper.getComponent(Slider).props("modelValue")).toEqual([95]);
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

  it("shows slider movement immediately and saves only on commit, preserving the model", async () => {
    const { wrapper, store } = mountSettings();
    await flushPromises();
    wrapper.getComponent(Slider).vm.$emit("update:modelValue", [74]);
    await flushPromises();
    expect(
      wrapper.get('[data-testid="pine-decisions-threshold-value"]').text(),
    ).toBe("74%");
    expect(setSettings).not.toHaveBeenCalled();
    wrapper.getComponent(Slider).vm.$emit("valueCommit", [74]);
    await flushPromises();
    expect(setSettings).toHaveBeenLastCalledWith({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      confidenceThreshold: 0.74,
    });
    expect(store.settings.confidenceThreshold).toBe(0.74);
    wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", "model");
    await flushPromises();
    expect(wrapper.findComponent(Slider).exists()).toBe(false);
    expect(store.settings.decisionsModel).toBe("typesafe/jev-1.13");
    expect(store.settings.confidenceThreshold).toBe(0.74);
  });

  it("rejects invalid slider values and toggle deselection", async () => {
    const { wrapper } = mountSettings();
    await flushPromises();
    for (const value of [[], [49], [101], [NaN]]) {
      wrapper.getComponent(Slider).vm.$emit("valueCommit", value);
    }
    wrapper.getComponent(ToggleGroup).vm.$emit("update:modelValue", "");
    expect(setSettings).not.toHaveBeenCalled();
  });

  it("locks controls during save and restores the saved threshold on failure", async () => {
    let rejectSave!: (error: Error) => void;
    setSettings.mockImplementation(
      () =>
        new Promise<PineAutoApprovalSettings>((_, reject) => {
          rejectSave = reject;
        }),
    );
    const { wrapper, store } = mountSettings();
    await flushPromises();
    wrapper.getComponent(Slider).vm.$emit("update:modelValue", [80]);
    wrapper.getComponent(Slider).vm.$emit("valueCommit", [80]);
    await flushPromises();
    expect(wrapper.getComponent(ToggleGroup).props("disabled")).toBe(true);
    rejectSave(new Error("Disk unavailable"));
    await flushPromises();
    expect(store.settings.confidenceThreshold).toBe(0.66);
    expect(wrapper.getComponent(Slider).props("modelValue")).toEqual([66]);
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
    wrapper.unmount();
    getSettings.mockResolvedValue({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      confidenceThreshold: 0.81,
    });
    const reopened = mountSettings("en-US");
    await flushPromises();
    expect(reopened.wrapper.text()).toContain("Screening approval threshold");
    expect(reopened.wrapper.getComponent(Slider).props("modelValue")).toEqual([
      81,
    ]);
  });
});
