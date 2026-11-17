import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { defineComponent } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { Command, CommandInput } from "@/components/ui/command";
import type { PineModelCatalog, PineModelDescriptor } from "@/shared/models";
import { useModelsStore } from "@/stores/models";
import ModelPickerList from "../ModelPickerList.vue";

vi.mock("@tanstack/vue-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/vue-virtual")>();
  const { withAllRows } = await import("./helpers/virtualRows");
  return {
    ...actual,
    useVirtualizer: withAllRows(actual.useVirtualizer),
  };
});

function model(
  id: string,
  name: string,
  providerId: string,
  providerName: string,
): PineModelDescriptor {
  return {
    api: "test",
    contextWindow: 128_000,
    id,
    input: ["text"],
    maxTokens: 8_192,
    name,
    providerId,
    providerName,
    reasoning: false,
    supportedThinkingLevels: ["off"],
  };
}

const catalog: PineModelCatalog = {
  models: [
    model("glm-4.5-air", "GLM 4.5 Air", "zai", "Z.AI"),
    model("glm-4.6", "GLM 4.6", "zai", "Z.AI"),
    model("claude-sonnet-4", "Claude Sonnet 4", "anthropic", "Anthropic"),
  ],
  providers: [
    {
      authMethods: [{ label: "API key", type: "api_key" }],
      configured: true,
      id: "zai",
      modelCount: 2,
      name: "Z.AI",
    },
    {
      authMethods: [{ label: "API key", type: "api_key" }],
      configured: true,
      id: "anthropic",
      modelCount: 1,
      name: "Anthropic",
    },
    {
      authMethods: [{ label: "OAuth", type: "oauth" }],
      configured: false,
      id: "google",
      modelCount: 3,
      name: "Google",
    },
  ],
  recommendedModelIds: ["glm-4.6"],
  imageModels: [
    {
      acceptsImageInput: true,
      id: "google/gemini-3-pro-image",
      name: "Nano Banana Pro",
      providerId: "openrouter",
      providerName: "OpenRouter",
      returnsText: true,
    },
    {
      acceptsImageInput: false,
      id: "openai/gpt-image-1",
      name: "GPT Image 1",
      providerId: "openrouter",
      providerName: "OpenRouter",
      returnsText: false,
    },
  ],
  recommendedImageModelIds: ["openai/gpt-image-1"],
  videoModels: [
    {
      id: "vendor/video-a",
      name: "Video A",
      providerId: "openrouter",
      providerName: "OpenRouter",
      supportedAspectRatios: [],
      supportedDurations: [],
      supportedResolutions: [],
    },
  ],
};

type Purpose = "session" | "image" | "video";

function mountList(purpose: Purpose = "session") {
  const pinia = createPinia();
  setActivePinia(pinia);
  useModelsStore().catalog = catalog;

  const Host = defineComponent({
    components: { Command, CommandInput, ModelPickerList },
    setup: () => ({ purpose }),
    template: `
      <Command>
        <CommandInput placeholder="search" />
        <ModelPickerList :favorite-keys="[]" :purpose="purpose" view="models" />
      </Command>
    `,
  });

  return mount(Host, {
    global: {
      plugins: [pinia, createAppI18n("zh-CN")],
      stubs: { ModelCapabilities: true, ProviderIcon: true },
    },
  });
}

function rowValues(wrapper: ReturnType<typeof mountList>): (string | null)[] {
  return wrapper
    .findAll("[data-picker-row]")
    .map((row) => row.attributes("data-value") ?? null);
}

function mediaRowValues(
  wrapper: ReturnType<typeof mountList>,
  kind: "image" | "video",
): (string | null)[] {
  return wrapper
    .findAll(`[data-picker-row=${kind}]`)
    .map((row) => row.attributes("data-value") ?? null);
}

describe("ModelPickerList", () => {
  it("lists configured providers with group headings", () => {
    const wrapper = mountList();

    expect(wrapper.text()).toContain("管理服务或模型");
    expect(wrapper.text()).toContain("推荐的模型");
    expect(wrapper.text()).toContain("Z.AI");
    expect(wrapper.text()).toContain("Anthropic");
    expect(wrapper.text()).not.toContain("Google");
    expect(rowValues(wrapper)).toContain("Z.AI GLM 4.5 Air glm-4.5-air");
    expect(rowValues(wrapper)).toContain(
      "Anthropic Claude Sonnet 4 claude-sonnet-4",
    );
  });

  it("filters models and drops groups without matches", async () => {
    const wrapper = mountList();

    await wrapper.get("[data-slot=command-input]").setValue("claude");

    expect(rowValues(wrapper)).toEqual([
      "Anthropic Claude Sonnet 4 claude-sonnet-4",
    ]);
    expect(wrapper.text()).not.toContain("GLM 4.5 Air");
    expect(wrapper.text()).toContain("Anthropic");
    expect(wrapper.text()).not.toContain("管理服务或模型");
  });

  it("shows the empty state when nothing matches", async () => {
    const wrapper = mountList();

    await wrapper.get("[data-slot=command-input]").setValue("nothing-here");

    expect(rowValues(wrapper)).toEqual([]);
    expect(wrapper.get("[data-slot=command-empty]").text()).toContain(
      "没有匹配的模型",
    );
  });

  it("lists recommended image models before the full image catalog", () => {
    const wrapper = mountList("image");

    expect(wrapper.text()).toContain("推荐的模型");
    expect(mediaRowValues(wrapper, "image")).toEqual([
      "OpenRouter GPT Image 1 openai/gpt-image-1",
      "OpenRouter Nano Banana Pro google/gemini-3-pro-image",
      "OpenRouter GPT Image 1 openai/gpt-image-1",
    ]);
    expect(wrapper.text()).not.toContain("GLM 4.6");
  });

  it("omits the recommended group when no video model is recommended", () => {
    const wrapper = mountList("video");

    expect(wrapper.text()).not.toContain("推荐的模型");
    expect(mediaRowValues(wrapper, "video")).toEqual([
      "OpenRouter Video A vendor/video-a",
    ]);
  });
});
