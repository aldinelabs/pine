export const GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:get-context-compaction-strategy" as const;
export const SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL =
  "preferences:set-context-compaction-strategy" as const;
export const GET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:get-diagnostic-logging" as const;
export const SET_DIAGNOSTIC_LOGGING_CHANNEL =
  "preferences:set-diagnostic-logging" as const;

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
