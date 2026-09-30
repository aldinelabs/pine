export const GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:get-context-compaction-strategy" as const;
export const SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:set-context-compaction-strategy" as const;
export const GET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:get-diagnostic-logging" as const;
export const SET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:set-diagnostic-logging" as const;
export const GET_AUTO_APPROVAL_SETTINGS_CHANNEL =
  "preferences:get-auto-approval-settings" as const;
export const SET_AUTO_APPROVAL_SETTINGS_CHANNEL =
  "preferences:set-auto-approval-settings" as const;

export interface PineAutoApprovalSettings {
  strategy: "model" | "decisions";
  decisionsModel: string;
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: PineAutoApprovalSettings = {
  strategy: "model",
  decisionsModel: "typesafe/jev-1.13",
};

export function isPineAutoApprovalSettings(
  value: unknown,
): value is PineAutoApprovalSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const settings = value as Record<string, unknown>;
  return (
    (settings.strategy === "model" || settings.strategy === "decisions") &&
    typeof settings.decisionsModel === "string" &&
    settings.decisionsModel.trim().length > 0 &&
    settings.decisionsModel.length <= 256
  );
}

export interface SetDiagnosticLoggingRequest {
  enabled: boolean;
}

export interface SetDiagnosticLoggingResult {
  enabled: boolean;
}

export type PineContextCompactionStrategy = "passive" | "recommended";

export const DEFAULT_CONTEXT_COMPACTION_STRATEGY =
  "recommended" satisfies PineContextCompactionStrategy;

export function isPineContextCompactionStrategy(
  value: unknown,
): value is PineContextCompactionStrategy {
  return value === "passive" || value === "recommended";
}

export interface SetContextCompactionStrategyRequest {
  strategy: PineContextCompactionStrategy;
}

export interface SetContextCompactionStrategyResult {
  updated: boolean;
}
