import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent, h } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Command } from "@/components/ui/command";
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/preferences";
import type { PineModelCatalog, PineModelDescriptor } from "@/shared/models";
import { useModelsStore } from "@/stores/models";
import ModelPickerDialog from "../ModelPickerDialog.vue";

vi.mock("@tanstack/vue-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/vue-virtual")>();
  const { withAllRows } = await import("./helpers/virtualRows");
  return {
    ...actual,
    useVirtualizer: withAllRows(actual.useVirtualizer),
  };
});

const passthroughStub = { template: "<div><slot /></div>" };
const alertDialogStub = {
  name: "AlertDialogStub",
  props: ["open"],
  emits: ["update:open"],
  template: '<div data-alert-dialog :data-open="open"><slot /></div>',
};
const commandDialogStub = defineComponent({
  name: "CommandDialogStub",
  props: { description: String, open: Boolean, title: String },
  setup(_props, { slots }) {
    return () => h(Command, null, { default: () => slots.default?.() });
  },
});
const customModelDialogStub = {
  name: "CustomModelDialogStub",
  props: ["open", "model"],
  emits: ["saved", "update:open"],
  template: '<div data-custom-model-dialog :data-open="open" />',
};
const customProviderDialogStub = {
  name: "CustomProviderDialogStub",
  props: ["open", "provider"],
  emits: ["saved", "update:open"],
  template: '<div data-custom-provider-dialog :data-open="open" />',
};
const buttonStub = {
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
};
const alertDialogActionStub = {
  name: "AlertDialogActionStub",
  props: ["disabled"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
};

const utilityModel: PineModelDescriptor = {
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
};

const connectedCatalog: PineModelCatalog = {
  models: [utilityModel],
  providers: [
    {
      authMethods: [{ label: "API key", type: "api_key" }],
      configured: true,
      id: "zai",
      modelCount: 1,
      name: "Z.AI",
    },
  ],
  recommendedModelIds: [utilityModel.id],
};

const customCatalog: PineModelCatalog = {
  models: [
    {
      ...utilityModel,
      isCustom: true,
      providerId: "custom-provider",
      providerName: "Custom provider",
    },
  ],
  providers: [
    {
      authMethods: [],
      configured: true,
      id: "custom-provider",
      isCustom: true,
      modelCount: 1,
      name: "Custom provider",
      api: "openai-completions",
      baseUrl: "http://localhost:11434/v1",
      hasApiKey: true,
    },
  ],
};

function mountPicker(
  purpose: "session" | "utility" | "image" | "decisions" = "session",
  catalog: PineModelCatalog = connectedCatalog,
) {
  const logoutProvider = vi.fn().mockResolvedValue({ disposed: true });
  const selectModel = vi.fn().mockResolvedValue(undefined);
  const selectUtilityModel = vi.fn().mockResolvedValue(undefined);
  const selectImageModel = vi.fn().mockResolvedValue(undefined);
  const getAutoApprovalSettings = vi
    .fn()
    .mockResolvedValue({ ...DEFAULT_AUTO_APPROVAL_SETTINGS });
  const setAutoApprovalSettings = vi.fn((settings) =>
    Promise.resolve(settings),
  );
  const getModelCatalog = vi.fn().mockResolvedValue(catalog);
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      getAutoApprovalSettings,
      setAutoApprovalSettings,
      getModelCatalog,
      logoutProvider,
      selectModel,
      selectImageModel,
      selectUtilityModel,
      addCustomModel: vi.fn(),
    },
  });

  const pinia = createPinia();
  setActivePinia(pinia);
  useModelsStore().catalog = catalog;

  const wrapper = mount(ModelPickerDialog, {
    props: { open: false, purpose },
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: {
        AlertDialog: alertDialogStub,
        AlertDialogAction: alertDialogActionStub,
        AlertDialogCancel: buttonStub,
        AlertDialogContent: passthroughStub,
        AlertDialogDescription: passthroughStub,
        AlertDialogFooter: passthroughStub,
        AlertDialogHeader: passthroughStub,
        AlertDialogTitle: passthroughStub,
        CommandDialog: commandDialogStub,
        CommandInput: passthroughStub,
        CustomModelDialog: customModelDialogStub,
        CustomProviderDialog: customProviderDialogStub,
        ProviderAuthDialog: passthroughStub,
        ProviderIcon: passthroughStub,
      },
    },
  });

  return {
    getAutoApprovalSettings,
    setAutoApprovalSettings,
    getModelCatalog,
    logoutProvider,
    selectImageModel,
    selectModel,
    selectUtilityModel,
    wrapper,
  };
}

describe("ModelPickerDialog provider management", () => {
  it("places Add custom model directly after Back to models", async () => {
    const { wrapper } = mountPicker();
    await wrapper
      .get(
        '[data-picker-row][data-value="manage configure provider service model"]',
      )
      .trigger("click");

    const values = wrapper
      .findAll("[data-picker-row]")
      .map((item) => item.attributes("data-value"));
    expect(values.slice(0, 2)).toEqual([
      "back models",
      "add custom model provider endpoint",
    ]);

    await wrapper
      .get('[data-picker-row][data-value="add custom model provider endpoint"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.emitted("update:open")).toContainEqual([false]);
    expect(
      wrapper.get("[data-custom-model-dialog]").attributes("data-open"),
    ).toBe("true");
  });

  it("confirms credential removal", async () => {
    const { getModelCatalog, logoutProvider, wrapper } = mountPicker();
    const manageItem = wrapper.get(
      '[data-picker-row][data-value="manage configure provider service model"]',
    );

    await manageItem.trigger("click");

    const disconnectButton = wrapper.get('[data-testid="provider-disconnect"]');
    await disconnectButton.trigger("click");

    expect(wrapper.get("[data-alert-dialog]").attributes("data-open")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain("解绑 Z.AI？");
    expect(wrapper.text()).toContain("删除 Pine 保存的 Z.AI 凭据");

    wrapper
      .findComponent({ name: "AlertDialogStub" })
      .vm.$emit("update:open", false);
    wrapper
      .findComponent({ name: "AlertDialogActionStub" })
      .vm.$emit("click", new MouseEvent("click", { cancelable: true }));
    await flushPromises();

    expect(logoutProvider).toHaveBeenCalledWith({ providerId: "zai" });
    expect(getModelCatalog).toHaveBeenCalledOnce();
    expect(wrapper.get("[data-alert-dialog]").attributes("data-open")).toBe(
      "false",
    );
  });

  it("offers edit actions for custom models and providers", async () => {
    const { wrapper } = mountPicker("session", customCatalog);

    await wrapper.get('[data-testid="custom-model-edit"]').trigger("click");
    await flushPromises();
    expect(
      wrapper.get("[data-custom-model-dialog]").attributes("data-open"),
    ).toBe("true");
    expect(
      wrapper.findComponent({ name: "CustomModelDialogStub" }).props("model"),
    ).toMatchObject({ id: utilityModel.id });

    wrapper
      .findComponent({ name: "CustomModelDialogStub" })
      .vm.$emit("update:open", false);
    await flushPromises();
    await wrapper
      .get(
        '[data-picker-row][data-value="manage configure provider service model"]',
      )
      .trigger("click");
    await wrapper.get('[data-testid="custom-provider-edit"]').trigger("click");
    await flushPromises();

    expect(
      wrapper.get("[data-custom-provider-dialog]").attributes("data-open"),
    ).toBe("true");
    expect(
      wrapper
        .findComponent({ name: "CustomProviderDialogStub" })
        .props("provider"),
    ).toMatchObject({ id: "custom-provider" });
  });
});

describe("ModelPickerDialog utility model selection", () => {
  it("selects the utility model without changing the session model", async () => {
    const { selectModel, selectUtilityModel, wrapper } = mountPicker("utility");
    const modelItem = wrapper
      .findAll("[data-picker-row]")
      .find((item) => item.attributes("data-value")?.includes(utilityModel.id));

    expect(modelItem).toBeDefined();
    await modelItem?.trigger("click");
    await flushPromises();

    expect(selectUtilityModel).toHaveBeenCalledWith({
      modelId: utilityModel.id,
      providerId: utilityModel.providerId,
    });
    expect(selectModel).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toContainEqual([false]);
  });
});

describe("ModelPickerDialog image model selection", () => {
  const imageModel = {
    acceptsImageInput: true,
    id: "google/gemini-3-pro-image",
    name: "Google: Nano Banana Pro",
    providerId: "openrouter",
    providerName: "OpenRouter",
    returnsText: true,
  };
  const imageCatalog: PineModelCatalog = {
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

  it("lists image models and selects one without touching the chat model", async () => {
    const { selectImageModel, selectModel, wrapper } = mountPicker(
      "image",
      imageCatalog,
    );
    const modelItem = wrapper
      .findAll("[data-picker-row]")
      .find((item) => item.attributes("data-value")?.includes(imageModel.id));

    expect(modelItem).toBeDefined();
    expect(wrapper.text()).toContain("Google: Nano Banana Pro");
    expect(modelItem?.text()).toContain(imageModel.id);

    await modelItem?.trigger("click");
    await flushPromises();

    expect(selectImageModel).toHaveBeenCalledWith({
      modelId: imageModel.id,
      providerId: imageModel.providerId,
    });
    expect(selectModel).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toContainEqual([false]);
  });

  it("still offers provider management for the image provider", async () => {
    const { wrapper } = mountPicker("image", imageCatalog);

    await wrapper
      .get(
        '[data-picker-row][data-value="manage configure provider service model"]',
      )
      .trigger("click");

    expect(
      wrapper
        .findAll("[data-picker-row]")
        .map((item) => item.attributes("data-value")),
    ).toContain("back models");
    expect(wrapper.text()).toContain("OpenRouter");
  });
});

describe("ModelPickerDialog Decisions model selection", () => {
  const decisionsCatalog: PineModelCatalog = {
    ...connectedCatalog,
    decisionsModels: [
      {
        id: "typesafe/jev-1.13",
        name: "Jev 1.13",
        providerId: "openrouter",
        providerName: "OpenRouter",
      },
      {
        id: "~typesafe/jev-latest",
        name: "Jev (latest)",
        providerId: "openrouter",
        providerName: "OpenRouter",
      },
      ...[
        "upstage/solar-decide",
        "respan/span-01",
        "respan/span-01-lite",
        "future/new-model",
      ].map((id) => ({
        id,
        name: id,
        providerId: "openrouter" as const,
        providerName: "OpenRouter" as const,
      })),
    ],
  };

  it("lists only Decisions models and saves a catalog selection without touching chat or image models", async () => {
    const { setAutoApprovalSettings, selectModel, selectImageModel, wrapper } =
      mountPicker("decisions", decisionsCatalog);
    expect(wrapper.findAll('[data-picker-row="decisions"]')).toHaveLength(6);
    expect(wrapper.find('[data-picker-row="model"]').exists()).toBe(false);
    expect(wrapper.find('[data-picker-row="image"]').exists()).toBe(false);
    await wrapper
      .get(
        '[data-picker-row="decisions"][data-value="OpenRouter Jev (latest) ~typesafe/jev-latest"]',
      )
      .trigger("click");
    await flushPromises();
    expect(setAutoApprovalSettings).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      decisionsModel: "~typesafe/jev-latest",
    });
    expect(selectModel).not.toHaveBeenCalled();
    expect(selectImageModel).not.toHaveBeenCalled();
    expect(wrapper.emitted("update:open")).toContainEqual([false]);
  });

  it.each([
    "upstage/solar-decide",
    "respan/span-01",
    "respan/span-01-lite",
    "future/new-model",
  ])("selects discovered model %s", async (id) => {
    const { wrapper, setAutoApprovalSettings } = mountPicker(
      "decisions",
      decisionsCatalog,
    );
    await wrapper
      .get(`[data-picker-row="decisions"][data-value="OpenRouter ${id} ${id}"]`)
      .trigger("click");
    await flushPromises();
    expect(setAutoApprovalSettings).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_AUTO_APPROVAL_SETTINGS,
      decisionsModel: id,
    });
  });

  it("offers provider management from the Decisions catalog", async () => {
    const { wrapper } = mountPicker("decisions", decisionsCatalog);
    await wrapper
      .get(
        '[data-picker-row][data-value="manage configure provider service model"]',
      )
      .trigger("click");
    expect(wrapper.text()).toContain("Z.AI");
    expect(
      wrapper.find('[data-picker-row][data-value="back models"]').exists(),
    ).toBe(true);
  });
});
