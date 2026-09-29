import {
  SettingsManager,
  shouldCompact,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { PineContextCompactionStrategy } from "../../../shared/preferences";
import { configureContextCompactionSettings } from "../compaction-settings";

const largeModel = {
  provider: "deepseek",
  id: "deepseek-flash",
  contextWindow: 1_000_000,
};
const smallModel = {
  provider: "test",
  id: "small",
  contextWindow: 128_000,
};

describe("configureContextCompactionSettings", () => {
  it("keeps the 400K trigger after Pi saves and reloads unrelated settings", async () => {
    const settings = SettingsManager.inMemory({});
    configureContextCompactionSettings(settings, () => "recommended");

    settings.setSteeringMode("all");
    settings.setDefaultThinkingLevel("high");
    settings.setDefaultModelAndProvider(largeModel.provider, largeModel.id);
    await settings.flush();
    await settings.reload();

    const compaction = settings.getCompactionSettings(largeModel);
    expect(compaction.reserveTokens).toBe(600_000);
    expect(shouldCompact(400_000, largeModel.contextWindow, compaction)).toBe(
      false,
    );
    expect(shouldCompact(400_001, largeModel.contextWindow, compaction)).toBe(
      true,
    );
    expect(shouldCompact(613_912, largeModel.contextWindow, compaction)).toBe(
      true,
    );
    expect(settings.getGlobalSettings().compaction).toBeUndefined();
  });

  it("resolves the threshold for each model without leaking overrides", () => {
    const settings = SettingsManager.inMemory({});
    configureContextCompactionSettings(settings, () => "recommended");

    expect(settings.getCompactionSettings(smallModel).reserveTokens).toBe(
      25_600,
    );
    expect(settings.getCompactionSettings(largeModel).reserveTokens).toBe(
      600_000,
    );
    settings.setSteeringMode("all");
    expect(settings.getCompactionSettings(smallModel).reserveTokens).toBe(
      25_600,
    );
  });

  it("restores ordinary and model-specific Pi settings in passive mode", async () => {
    const original = {
      enabled: false,
      reserveTokens: 24_000,
      keepRecentTokens: 12_000,
      modelOverrides: {
        "deepseek/deepseek-flash": {
          reserveTokens: 32_000,
          keepRecentTokens: 9_000,
        },
      },
    };
    const settings = SettingsManager.inMemory({ compaction: original });
    let strategy: PineContextCompactionStrategy = "recommended";
    configureContextCompactionSettings(settings, () => strategy);

    expect(settings.getCompactionSettings(largeModel)).toEqual({
      enabled: true,
      reserveTokens: 600_000,
      keepRecentTokens: 9_000,
    });
    settings.setSteeringMode("all");
    await settings.reload();
    strategy = "passive";
    expect(settings.getCompactionSettings(largeModel)).toEqual({
      enabled: false,
      reserveTokens: 32_000,
      keepRecentTokens: 9_000,
    });
    expect(settings.getCompactionSettings(smallModel)).toEqual({
      enabled: false,
      reserveTokens: 24_000,
      keepRecentTokens: 12_000,
    });
    strategy = "recommended";
    expect(settings.getCompactionSettings(largeModel).reserveTokens).toBe(
      600_000,
    );
    expect(settings.getGlobalSettings().compaction).toEqual(original);
  });
});
