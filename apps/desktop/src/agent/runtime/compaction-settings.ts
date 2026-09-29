import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PineContextCompactionStrategy } from "../../shared/preferences";
import { recommendedCompactionReserveTokens } from "./context-metrics";

/** Resolve Pine's policy on every read: Pi discards applyOverrides on save/reload. */
export function configureContextCompactionSettings(
  settingsManager: SettingsManager,
  getStrategy: () => PineContextCompactionStrategy,
): void {
  const getCompactionSettings =
    settingsManager.getCompactionSettings.bind(settingsManager);

  settingsManager.getCompactionSettings = (model?: {
    provider: string;
    id: string;
    contextWindow?: number;
  }) => {
    const settings = getCompactionSettings(model);
    if (getStrategy() !== "recommended") return settings;

    return {
      ...settings,
      enabled: true,
      ...(model?.contextWindow && model.contextWindow > 0
        ? {
            reserveTokens: recommendedCompactionReserveTokens(
              model.contextWindow,
            ),
          }
        : {}),
    };
  };
}
