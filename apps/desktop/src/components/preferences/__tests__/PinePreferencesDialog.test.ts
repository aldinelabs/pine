import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_LOCALE_STORAGE_KEY, createAppI18n } from "@/app/i18n";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/preferences";
import type { PineModelCatalog } from "@/shared/models";
import { createDefaultPineUserProfile } from "@/shared/userProfile";
import {
  SIDEBAR_VIBRANCY_STORAGE_KEY,
  THEME_PREFERENCE_STORAGE_KEY,
  useAppearanceStore,
} from "@/stores/appearance";
import { useModelsStore } from "@/stores/models";
import PinePreferencesDialog from "../PinePreferencesDialog.vue";

const passthroughStub = { template: "<div><slot /></div>" };
const modelPickerStub = {
  props: ["open", "purpose"],
  emits: ["update:open"],
  template:
    '<div data-model-picker :data-open="open" :data-purpose="purpose" />',
};
const setSidebarVibrancy = vi.fn().mockResolvedValue({ applied: true });
const getTinyFishCredentialStatus = vi
  .fn()
  .mockResolvedValue({ configured: false });
const setTinyFishApiKey = vi.fn().mockResolvedValue({ configured: true });
const getUserProfile = vi.fn();
const setUserProfile = vi.fn().mockResolvedValue({ updated: true });
const getContextCompactionStrategy = vi.fn().mockResolvedValue("recommended");
const setContextCompactionStrategy = vi.fn().mockResolvedValue({
  updated: true,
});
const getAutoApprovalSettings = vi
  .fn()
  .mockResolvedValue({ ...DEFAULT_AUTO_APPROVAL_SETTINGS });
const setAutoApprovalSettings = vi.fn((settings) => Promise.resolve(settings));
const getDiagnosticLogging = vi.fn().mockResolvedValue(false);
const setDiagnosticLogging = vi.fn(({ enabled }: { enabled: boolean }) =>
  Promise.resolve({ enabled }),
);

function installPineApi(platform: string | undefined): void {
  const pineWindow = window as unknown as {
    pine?: {
      platform: string;
      setSidebarVibrancy: typeof setSidebarVibrancy;
      getTinyFishCredentialStatus: typeof getTinyFishCredentialStatus;
      setTinyFishApiKey: typeof setTinyFishApiKey;
      getUserProfile: typeof getUserProfile;
      setUserProfile: typeof setUserProfile;
      getContextCompactionStrategy: typeof getContextCompactionStrategy;
      setContextCompactionStrategy: typeof setContextCompactionStrategy;
      getAutoApprovalSettings: typeof getAutoApprovalSettings;
      setAutoApprovalSettings: typeof setAutoApprovalSettings;
      getDiagnosticLogging: typeof getDiagnosticLogging;
      setDiagnosticLogging: typeof setDiagnosticLogging;
    };
  };
  if (platform === undefined) {
    delete pineWindow.pine;
    return;
  }
  pineWindow.pine = {
    platform,
    setSidebarVibrancy,
    getTinyFishCredentialStatus,
    setTinyFishApiKey,
    getUserProfile,
    setUserProfile,
    getContextCompactionStrategy,
    setContextCompactionStrategy,
    getAutoApprovalSettings,
    setAutoApprovalSettings,
    getDiagnosticLogging,
    setDiagnosticLogging,
  };
}

function mountDialog() {
  const pinia = createPinia();
  const i18n = createAppI18n("zh-CN");
  setActivePinia(pinia);

  const wrapper = mount(PinePreferencesDialog, {
    global: {
      plugins: [pinia, i18n],
      stubs: {
        Dialog: passthroughStub,
        DialogContent: passthroughStub,
        DialogDescription: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        DialogTrigger: passthroughStub,
        ModelPickerDialog: modelPickerStub,
      },
    },
  });

  return { i18n, pinia, wrapper };
}

/** Switches the settings dialog to one of its left-rail categories. */
async function openSection(wrapper: VueWrapper, label: string): Promise<void> {
  const tab = wrapper
    .findAll('[data-slot="item"]')
    .find((candidate) => candidate.text().includes(label));
  if (!tab) throw new Error(`Missing preferences section: ${label}`);
  await tab.trigger("click");
  await flushPromises();
}

describe("PinePreferencesDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.remove("sidebar-vibrancy");
    document.documentElement.lang = "zh-CN";
    setSidebarVibrancy.mockClear();
    getTinyFishCredentialStatus.mockClear();
    setTinyFishApiKey.mockClear();
    getUserProfile.mockReset();
    getUserProfile.mockResolvedValue({
      communicationStyle: "calm-professional",
      customInstructions: "",
      nickname: "",
      personalDetails: "",
      technicalBackground: "enthusiast",
    });
    setUserProfile.mockClear();
    getContextCompactionStrategy.mockClear();
    setContextCompactionStrategy.mockClear();
    getAutoApprovalSettings
      .mockReset()
      .mockResolvedValue({ ...DEFAULT_AUTO_APPROVAL_SETTINGS });
    setAutoApprovalSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve(settings));
    getDiagnosticLogging.mockReset().mockResolvedValue(false);
    setDiagnosticLogging
      .mockReset()
      .mockImplementation(({ enabled }) => Promise.resolve({ enabled }));
    getTinyFishCredentialStatus.mockResolvedValue({ configured: false });
    setTinyFishApiKey.mockResolvedValue({ configured: true });
    installPineApi(undefined);
  });

  afterEach(() => {
    installPineApi(undefined);
  });

  it("places automatic approval below context compaction and uses a help tooltip", async () => {
    installPineApi("darwin");
    const { wrapper } = mountDialog();
    await openSection(wrapper, "执行环境");
    const labels = wrapper
      .findAll('[data-slot="field-label"]')
      .map((label) => label.text());
    expect(labels.indexOf("Decisions 初筛模型")).toBe(
      labels.indexOf("图像生成模型") + 1,
    );
    expect(labels.indexOf("自动审批路径")).toBeGreaterThan(
      labels.indexOf("上下文压缩策略"),
    );
    expect(wrapper.find('[aria-label="关于自动审批路径"]').exists()).toBe(true);
    expect(wrapper.find("#pine-decisions-model").exists()).toBe(false);
    expect(
      wrapper.find('[data-testid="pine-decisions-threshold-slider"]').exists(),
    ).toBe(false);
  });

  it("places diagnostic logging description in a help tooltip", async () => {
    const { wrapper } = mountDialog();
    await openSection(wrapper, "通用");
    const help = wrapper.get('[aria-label="关于诊断日志"]');
    expect(help.attributes("type")).toBe("button");
    expect(wrapper.find("#pine-diagnostic-logging-description").exists()).toBe(
      false,
    );
    expect(
      wrapper
        .get('[data-testid="pine-diagnostic-logging-toggle"]')
        .attributes("aria-describedby"),
    ).toBeUndefined();
    expect(wrapper.text()).not.toContain("记录本机错误和睡眠恢复事件");
    await help.trigger("focus");
    await flushPromises();
    expect(
      document.querySelector('[data-slot="tooltip-content"]')?.textContent,
    ).toContain("记录本机错误和睡眠恢复事件，便于排查故障。");
    wrapper.unmount();
  });

  it("shows the selected utility model name", async () => {
    const { pinia, wrapper } = mountDialog();
    const catalog: PineModelCatalog = {
      models: [
        {
          api: "test",
          contextWindow: 128_000,
          id: "glm-4.5-air",
          input: ["text"],
          maxTokens: 8_192,
          name: "GLM 4.5 Air",
          providerId: "zai",
          providerName: "Z.AI",
          reasoning: false,
          supportedThinkingLevels: ["off"],
        },
      ],
      providers: [],
      utilitySelection: { modelId: "glm-4.5-air", providerId: "zai" },
    };

    useModelsStore(pinia).catalog = catalog;
    await openSection(wrapper, "执行环境");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("GLM 4.5 Air");
    expect(wrapper.text()).not.toContain("未选择任何模型");
  });

  it("shows the configured image model and opens the image picker", async () => {
    const { pinia, wrapper } = mountDialog();
    const imageModel = {
      acceptsImageInput: true,
      id: "google/gemini-3-pro-image",
      name: "Google: Nano Banana Pro",
      providerId: "openrouter",
      providerName: "OpenRouter",
      returnsText: true,
    };
    useModelsStore(pinia).catalog = {
      imageModels: [imageModel],
      imageSelection: {
        modelId: imageModel.id,
        providerId: imageModel.providerId,
      },
      models: [],
      providers: [
        {
          authMethods: [{ label: "API key", type: "api_key" }],
          configured: true,
          id: "openrouter",
          modelCount: 0,
          name: "OpenRouter",
        },
      ],
    };

    await openSection(wrapper, "执行环境");

    expect(wrapper.text()).toContain(imageModel.name);
    expect(wrapper.text()).not.toContain("尚未配置 OpenRouter");

    const picker = wrapper
      .findAll("[data-model-picker]")
      .find((candidate) => candidate.attributes("data-purpose") === "image");
    expect(picker?.attributes("data-open")).toBe("false");

    await wrapper
      .get('[data-testid="pine-image-model-button"]')
      .trigger("click");

    expect(picker?.attributes("data-open")).toBe("true");
  });

  it("points at OpenRouter when no image model can be picked yet", async () => {
    const { pinia, wrapper } = mountDialog();
    useModelsStore(pinia).catalog = {
      imageModels: [
        {
          acceptsImageInput: false,
          id: "black-forest-labs/flux.2-pro",
          name: "FLUX.2 Pro",
          providerId: "openrouter",
          providerName: "OpenRouter",
          returnsText: false,
        },
      ],
      models: [],
      providers: [],
    };

    await openSection(wrapper, "执行环境");

    expect(wrapper.text()).toContain("尚未配置 OpenRouter");
  });

  it("saves a TinyFish key from the harness section", async () => {
    installPineApi("linux");
    const { wrapper } = mountDialog();
    await openSection(wrapper, "执行环境");

    await wrapper
      .get('[data-testid="pine-tinyfish-credential-button"]')
      .trigger("click");
    await wrapper.get('input[type="password"]').setValue("tinyfish-secret");
    await wrapper.get("form").trigger("submit");

    await vi.waitFor(() =>
      expect(setTinyFishApiKey).toHaveBeenCalledWith({
        apiKey: "tinyfish-secret",
      }),
    );
    expect(wrapper.text()).toContain("更改密钥");
  });

  it("opens the shared model picker in utility mode", async () => {
    const { wrapper } = mountDialog();
    await openSection(wrapper, "执行环境");
    const picker = wrapper
      .findAll("[data-model-picker]")
      .find((candidate) => candidate.attributes("data-purpose") === "utility");

    expect(picker?.attributes("data-open")).toBe("false");

    await wrapper
      .get('[data-testid="pine-utility-model-button"]')
      .trigger("click");

    expect(picker?.attributes("data-open")).toBe("true");
  });

  it("edits the user profile inline in the personalization section", async () => {
    installPineApi("linux");
    getUserProfile.mockResolvedValue({
      ...createDefaultPineUserProfile(),
      nickname: "Loaded nickname",
    });
    const { wrapper } = mountDialog();
    await openSection(wrapper, "用户画像");

    const form = wrapper.get('[data-testid="pine-user-profile-form"]');
    const nickname = form.get("#pine-user-profile-nickname");
    expect(
      form
        .get('[data-slot="scroll-area"]')
        .classes()
        .some((className) => className.includes("scroll-fade")),
    ).toBe(true);
    await vi.waitFor(() =>
      expect((nickname.element as HTMLInputElement).value).toBe(
        "Loaded nickname",
      ),
    );

    expect(form.find('button[type="submit"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("冷静专业");

    const [styleGroup, backgroundGroup] = wrapper
      .findAllComponents(ToggleGroup)
      .filter((group) =>
        [
          "pine-user-profile-style-label",
          "pine-user-profile-background-label",
        ].includes(group.attributes("aria-labelledby") ?? ""),
      );

    expect(styleGroup?.props("modelValue")).toBe("calm-professional");
    expect(backgroundGroup?.props("modelValue")).toBe("enthusiast");

    await nickname.setValue("  小 Pine  ");
    await form
      .get("#pine-user-profile-details")
      .setValue("正在学习桌面应用开发");
    await form
      .get("#pine-user-profile-instructions")
      .setValue("先给出结论，再解释关键原因。");
    styleGroup?.vm.$emit("update:modelValue", "warm-friendly");
    backgroundGroup?.vm.$emit("update:modelValue", "professional-user");
    await wrapper.vm.$nextTick();

    await vi.waitFor(() =>
      expect(setUserProfile).toHaveBeenCalledWith({
        communicationStyle: "warm-friendly",
        customInstructions: "先给出结论，再解释关键原因。",
        nickname: "小 Pine",
        personalDetails: "正在学习桌面应用开发",
        technicalBackground: "professional-user",
      }),
    );

    await vi.waitFor(() =>
      expect((nickname.element as HTMLInputElement).value).toBe("小 Pine"),
    );
  });

  it("applies and persists language and theme selections", async () => {
    const { i18n, pinia, wrapper } = mountDialog();
    const groups = wrapper.findAllComponents(ToggleGroup);

    groups[0]?.vm.$emit("update:modelValue", "en-US");
    groups[1]?.vm.$emit("update:modelValue", "dark");
    await wrapper.vm.$nextTick();

    expect(i18n.global.locale.value).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(useAppearanceStore(pinia).themePreference).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe(
      "dark",
    );
  });

  it("loads the recommended compaction strategy and persists changes", async () => {
    installPineApi("linux");
    const { wrapper } = mountDialog();
    await openSection(wrapper, "执行环境");
    await vi.waitFor(() =>
      expect(getContextCompactionStrategy).toHaveBeenCalled(),
    );
    const group = wrapper
      .findAllComponents(ToggleGroup)
      .find(
        (candidate) =>
          candidate.attributes("aria-labelledby") ===
          "pine-context-compaction-strategy-setting",
      );

    expect(group?.props("modelValue")).toBe("recommended");
    group?.vm.$emit("update:modelValue", "passive");

    await vi.waitFor(() =>
      expect(setContextCompactionStrategy).toHaveBeenCalledWith({
        strategy: "passive",
      }),
    );
  });

  it("loads and saves diagnostic logging in general preferences", async () => {
    installPineApi("linux");
    getDiagnosticLogging.mockResolvedValueOnce(true);
    const { wrapper } = mountDialog();
    await flushPromises();
    const toggle = wrapper.get(
      '[data-testid="pine-diagnostic-logging-toggle"]',
    );
    expect(toggle.attributes("aria-checked")).toBe("true");
    expect(toggle.attributes("disabled")).toBeUndefined();
    await toggle.trigger("click");
    await flushPromises();
    expect(setDiagnosticLogging).toHaveBeenCalledWith({ enabled: false });
    expect(toggle.attributes("aria-checked")).toBe("false");
  });

  it("restores the diagnostic logging toggle when saving fails", async () => {
    installPineApi("linux");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    setDiagnosticLogging.mockRejectedValueOnce(
      new Error("Unable to save settings"),
    );
    const { wrapper } = mountDialog();
    await flushPromises();
    const toggle = wrapper.get(
      '[data-testid="pine-diagnostic-logging-toggle"]',
    );
    await toggle.trigger("click");
    await flushPromises();
    expect(setDiagnosticLogging).toHaveBeenCalledWith({ enabled: true });
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(toggle.attributes("disabled")).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it("shows the compaction description from a focusable help badge", async () => {
    const { wrapper } = mountDialog();
    await openSection(wrapper, "执行环境");
    const helpBadge = wrapper.get('button[aria-label="关于上下文压缩策略"]');
    const description =
      "推荐设置会在上下文达到 80% 时压缩，并将触发上限限制在 400K Token。";

    expect(wrapper.getComponent(Badge).props("variant")).toBe("secondary");
    expect(helpBadge.text()).toBe("");
    expect(helpBadge.classes()).toEqual(
      expect.arrayContaining(["size-5", "translate-y-px", "p-0"]),
    );
    expect(helpBadge.find("svg").attributes("aria-hidden")).toBe("true");
    expect(
      wrapper
        .findAll('[data-slot="field-description"]')
        .some((fieldDescription) => fieldDescription.text() === description),
    ).toBe(false);

    await helpBadge.trigger("focus");
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-slot="tooltip-content"]')?.textContent,
      ).toContain(description);
    });
  });

  it("toggles the macOS sidebar vibrancy effect", async () => {
    installPineApi("darwin");
    const { wrapper } = mountDialog();
    const toggle = wrapper.get('[data-testid="pine-sidebar-vibrancy-toggle"]');

    expect(wrapper.text()).toContain("\u4fa7\u680f\u6a21\u7cca\u6548\u679c");

    await toggle.trigger("click");

    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY)).toBe(
      "true",
    );
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: true });

    await toggle.trigger("click");

    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY)).toBe(
      "false",
    );
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: false });
  });
});
