import { z } from "zod";
import {
  readPineAgentSettings,
  writeApproximateLocationEnabled,
  writeAttentionNotificationsEnabled,
  writeAutoApprovalSettings,
  writeCompletionSignalMode,
  writeContextCompactionRoute,
  writeContextCompactionStrategy,
  writeDiagnosticLoggingEnabled,
  writePineUserProfile,
} from "../../../agent/pineSettings";
import {
  DEFAULT_APPROXIMATE_LOCATION_ENABLED,
  GET_APPROXIMATE_LOCATION_CHANNEL,
  SET_APPROXIMATE_LOCATION_CHANNEL,
  type SetApproximateLocationResult,
} from "../../../shared/approximateLocation";
import {
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  DEFAULT_CONTEXT_COMPACTION_ROUTE,
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  GET_ATTENTION_NOTIFICATIONS_CHANNEL,
  GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  GET_COMPLETION_SIGNAL_CHANNEL,
  GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  GET_DIAGNOSTIC_LOGGING_CHANNEL,
  PINE_COMPLETION_SIGNAL_MODES,
  SET_ATTENTION_NOTIFICATIONS_CHANNEL,
  SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
  SET_COMPLETION_SIGNAL_CHANNEL,
  SET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
  SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
  SET_DIAGNOSTIC_LOGGING_CHANNEL,
  isPineAutoApprovalSettings,
  type PineAutoApprovalSettings,
  type PineCompletionSignalMode,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
  type SetAttentionNotificationsResult,
  type SetCompletionSignalResult,
  type SetContextCompactionRouteResult,
  type SetContextCompactionStrategyResult,
  type SetDiagnosticLoggingResult,
} from "../../../shared/preferences";
import {
  GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
  SET_TINYFISH_API_KEY_CHANNEL,
  type SetTinyFishApiKeyResult,
  type TinyFishCredentialStatus,
} from "../../../shared/tinyfish";
import {
  GET_USER_PROFILE_CHANNEL,
  SET_USER_PROFILE_CHANNEL,
  createDefaultPineUserProfile,
  type PineUserProfile,
  type SetUserProfileResult,
} from "../../../shared/userProfile";
import {
  GET_EXCHANGE_RATES_CHANNEL,
  type PineCurrencyInfo,
} from "../../../shared/currency";
import { GET_APP_VERSION_CHANNEL } from "../../../shared/window";
import type { PineCore } from "../pineCore";
import {
  SetContextCompactionRouteRequestSchema,
  SetContextCompactionStrategyRequestSchema,
  SetTinyFishApiKeyRequestSchema,
  UserProfileSchema,
} from "../requestSchemas";

export function registerSettingsRequests(core: PineCore): void {
  const settings = () => readPineAgentSettings(core.agentDirectory);

  core.handle(GET_APP_VERSION_CHANNEL, (): string => core.host.version);

  core.handle(
    GET_EXCHANGE_RATES_CHANNEL,
    async (): Promise<PineCurrencyInfo> => ({
      rates: await core.exchangeRates.get(),
      systemRegion: core.host.systemRegion ?? null,
    }),
  );

  core.handle(
    GET_TINYFISH_CREDENTIAL_STATUS_CHANNEL,
    (): TinyFishCredentialStatus => ({
      configured: core.credentials.isConfigured(),
    }),
  );

  core.handle(
    SET_TINYFISH_API_KEY_CHANNEL,
    async (_context, request: unknown): Promise<SetTinyFishApiKeyResult> => {
      const { apiKey } = SetTinyFishApiKeyRequestSchema.parse(request);
      await core.credentials.setApiKey(apiKey);
      await core.runtimes.setTinyFishApiKey(core.credentials.getApiKey());
      return { configured: core.credentials.isConfigured() };
    },
  );

  core.handle(
    GET_USER_PROFILE_CHANNEL,
    async (): Promise<PineUserProfile> =>
      (await settings()).userProfile ?? createDefaultPineUserProfile(),
  );

  core.handle(
    SET_USER_PROFILE_CHANNEL,
    async (_context, profile: unknown): Promise<SetUserProfileResult> => {
      const parsed = UserProfileSchema.parse(profile);
      await writePineUserProfile(
        core.agentDirectory,
        parsed satisfies PineUserProfile,
      );
      return { updated: true };
    },
  );

  core.handle(
    GET_AUTO_APPROVAL_SETTINGS_CHANNEL,
    async (): Promise<PineAutoApprovalSettings> =>
      (await settings()).autoApproval ?? { ...DEFAULT_AUTO_APPROVAL_SETTINGS },
  );

  core.handle(
    SET_AUTO_APPROVAL_SETTINGS_CHANNEL,
    async (_context, request: unknown): Promise<PineAutoApprovalSettings> => {
      const parsed = z
        .custom<PineAutoApprovalSettings>(isPineAutoApprovalSettings)
        .parse(request);
      const normalized = {
        strategy: parsed.strategy,
        decisionsModel: parsed.decisionsModel.trim(),
      };
      await writeAutoApprovalSettings(core.agentDirectory, normalized);
      return normalized;
    },
  );

  core.handle(
    GET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
    async (): Promise<PineContextCompactionStrategy> =>
      (await settings()).contextCompactionStrategy ??
      DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  );

  core.handle(
    SET_CONTEXT_COMPACTION_STRATEGY_CHANNEL,
    async (
      _context,
      request: unknown,
    ): Promise<SetContextCompactionStrategyResult> => {
      const { strategy } =
        SetContextCompactionStrategyRequestSchema.parse(request);
      await writeContextCompactionStrategy(core.agentDirectory, strategy);
      await core.runtimes.setContextCompactionStrategy(strategy);
      return { updated: true };
    },
  );

  core.handle(
    GET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
    async (): Promise<PineContextCompactionRoute> =>
      (await settings()).contextCompactionRoute ??
      DEFAULT_CONTEXT_COMPACTION_ROUTE,
  );

  core.handle(
    SET_CONTEXT_COMPACTION_ROUTE_CHANNEL,
    async (
      _context,
      request: unknown,
    ): Promise<SetContextCompactionRouteResult> => {
      const { route } = SetContextCompactionRouteRequestSchema.parse(request);
      await writeContextCompactionRoute(core.agentDirectory, route);
      await core.runtimes.setContextCompactionRoute(route);
      return { updated: true };
    },
  );

  core.handle(
    GET_COMPLETION_SIGNAL_CHANNEL,
    (): PineCompletionSignalMode => core.completionSignalMode,
  );

  core.handle(
    SET_COMPLETION_SIGNAL_CHANNEL,
    async (_context, request: unknown): Promise<SetCompletionSignalResult> => {
      const { mode } = z
        .object({ mode: z.enum(PINE_COMPLETION_SIGNAL_MODES) })
        .parse(request);
      await writeCompletionSignalMode(core.agentDirectory, mode);
      core.completionSignalMode = mode;
      return { mode };
    },
  );

  core.handle(
    GET_ATTENTION_NOTIFICATIONS_CHANNEL,
    (): boolean => core.attentionNotificationsEnabled,
  );

  core.handle(
    SET_ATTENTION_NOTIFICATIONS_CHANNEL,
    async (
      _context,
      request: unknown,
    ): Promise<SetAttentionNotificationsResult> => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
      await writeAttentionNotificationsEnabled(core.agentDirectory, enabled);
      core.attentionNotificationsEnabled = enabled;
      core.host.attentionNotificationsChanged?.(enabled);
      return { enabled };
    },
  );

  core.handle(
    GET_APPROXIMATE_LOCATION_CHANNEL,
    async (): Promise<boolean> =>
      (await settings()).approximateLocationEnabled ??
      DEFAULT_APPROXIMATE_LOCATION_ENABLED,
  );

  core.handle(
    SET_APPROXIMATE_LOCATION_CHANNEL,
    async (
      _context,
      request: unknown,
    ): Promise<SetApproximateLocationResult> => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
      await writeApproximateLocationEnabled(core.agentDirectory, enabled);
      if (enabled) void core.location().refresh();
      return { enabled };
    },
  );

  core.handle(
    GET_DIAGNOSTIC_LOGGING_CHANNEL,
    (): boolean => core.diagnostics.isEnabled,
  );

  core.handle(
    SET_DIAGNOSTIC_LOGGING_CHANNEL,
    async (_context, request: unknown): Promise<SetDiagnosticLoggingResult> => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
      await writeDiagnosticLoggingEnabled(core.agentDirectory, enabled);
      await core.diagnostics.setEnabled(enabled);
      if (enabled) {
        core.diagnostics.record("diagnostics:enabled", {
          version: core.host.version,
          ...core.host.runtime,
          platform: process.platform,
        });
      }
      return { enabled };
    },
  );
}
