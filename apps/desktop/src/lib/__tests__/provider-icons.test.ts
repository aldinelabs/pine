import { describe, expect, it } from "vitest";
import {
  monoIconSource,
  resolveModelIcon,
  resolveProviderIcon,
} from "../provider-icons";

function vendorIcon(vendor: string) {
  const icon = resolveProviderIcon(vendor);
  expect(icon, vendor).toBeDefined();
  return icon;
}

describe("resolveModelIcon", () => {
  it.each([
    ["anthropic/claude-opus-5.5", "anthropic"],
    ["openai/gpt-5.2", "openai"],
    ["google/gemini-3-pro", "google"],
    ["x-ai/grok-5", "xai"],
    ["deepseek/deepseek-v4", "deepseek"],
    ["moonshotai/kimi-k3", "moonshot"],
    ["z-ai/glm-5.3", "zhipu"],
    ["minimax/minimax-m3", "minimax"],
    ["mistralai/mistral-large", "mistral"],
    ["~anthropic/claude-sonnet-latest", "anthropic"],
  ])("uses the vendor segment of %s", (id, vendor) => {
    expect(resolveModelIcon({ id, providerId: "openrouter" })).toBe(
      vendorIcon(vendor),
    );
  });

  it("maps vendors that are not providers themselves", () => {
    const qwen = resolveModelIcon({ id: "qwen/qwen3-max", providerId: "x" });
    const meta = resolveModelIcon({
      id: "meta-llama/llama-4",
      providerId: "x",
    });
    const seed = resolveModelIcon({
      id: "bytedance-seed/seedream-4.5",
      providerId: "x",
    });
    const bfl = resolveModelIcon({
      id: "black-forest-labs/flux.2-pro",
      providerId: "x",
    });
    expect(new Set([qwen, meta, seed, bfl]).size).toBe(4);
    for (const icon of [qwen, meta, seed, bfl]) {
      expect(icon?.src).toEqual(expect.any(String));
    }
    expect(resolveModelIcon({ id: "microsoft/phi-5", providerId: "x" })).toBe(
      resolveModelIcon({ id: "phi-5", providerId: "x" }),
    );
  });

  it.each([
    ["claude-opus-5.5", "anthropic"],
    ["gpt-5.2-codex", "openai"],
    ["o3-mini", "openai"],
    ["gemini-3-flash", "google"],
    ["grok-5", "xai"],
    ["deepseek-flash", "deepseek"],
    ["glm-5.3-flash", "zhipu"],
    ["kimi-k3", "moonshot"],
    ["MiniMax-M3", "minimax"],
  ])("recognizes the bare model ID %s", (id, vendor) => {
    expect(resolveModelIcon({ id, providerId: "custom-proxy" })).toBe(
      vendorIcon(vendor),
    );
  });

  it("recognizes Tencent Hunyuan bare IDs", () => {
    const hy = resolveModelIcon({ id: "hy4-flash", providerId: "x" });
    expect(hy).toBeDefined();
    expect(resolveModelIcon({ id: "hunyuan-t2", providerId: "x" })).toBe(hy);
  });

  it("falls back to the model name, ignoring an OpenRouter vendor label", () => {
    expect(
      resolveModelIcon({
        id: "acme/model-7",
        name: "Anthropic: Claude Opus 5.5",
        providerId: "openrouter",
      }),
    ).toBe(vendorIcon("anthropic"));
  });

  it("uses the serving provider for bare IDs it cannot place", () => {
    expect(resolveModelIcon({ id: "speed-preview", providerId: "groq" })).toBe(
      vendorIcon("groq"),
    );
  });

  it("does not show the aggregator's logo for an unknown vendor", () => {
    expect(
      resolveModelIcon({ id: "heygen/avatar-iv", providerId: "openrouter" }),
    ).toBeUndefined();
  });

  it("returns nothing for unknown bare IDs on unknown providers", () => {
    expect(
      resolveModelIcon({ id: "my-model", providerId: "my-proxy" }),
    ).toBeUndefined();
  });
});

describe("monoIconSource", () => {
  it("uses the single-colour variant of a colour icon", () => {
    const openRouter = resolveProviderIcon("openrouter");
    expect(openRouter?.monoSrc).toEqual(expect.any(String));
    expect(openRouter && monoIconSource(openRouter)).toBe(openRouter?.monoSrc);
    expect(openRouter?.monoSrc).not.toBe(openRouter?.src);
  });

  it("keeps an icon that is already single-colour", () => {
    const anthropic = resolveProviderIcon("anthropic");
    expect(anthropic?.monochrome).toBe(true);
    expect(anthropic && monoIconSource(anthropic)).toBe(anthropic?.src);
  });

  it("has a single-colour source for every colour provider icon", () => {
    for (const provider of [
      "amazon-bedrock",
      "azure-openai-responses",
      "deepseek",
      "google",
      "google-vertex",
      "kimi-coding",
      "minimax",
      "mistral",
      "openrouter",
      "zai",
    ]) {
      const icon = resolveProviderIcon(provider);
      expect(icon?.monochrome || Boolean(icon?.monoSrc), provider).toBe(true);
    }
  });
});
