import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isWebServerSettings,
  readWebServerSettings,
  type WebServerSettings,
} from "../shared/webControl";
import { decisionsModelDescriptors } from "./runtime/decisions-models";
import type {
  PineImageModelSelection,
  PineVideoModelSelection,
  PineApprovalModelSelection,
  PinePromptRewriteModelSelection,
  PineLiveTranslationModelSelection,
  PineUtilityModelSelection,
} from "../shared/models";
import {
  isPineAutoApprovalSettings,
  isPineCompletionSignalMode,
  type PineCompletionSignalMode,
  type PineAutoApprovalSettings,
  isPineContextCompactionRoute,
  isPineContextCompactionStrategy,
  type PineContextCompactionRoute,
  type PineContextCompactionStrategy,
} from "../shared/preferences";
import type { PiProvidersSetting } from "../shared/piProviders";
import {
  isPineToolGroupId,
  type PineToolGroupId,
  type PineToolGroups,
} from "../shared/toolGroups";
import {
  isPineCommunicationStyle,
  isPinePronouns,
  isPineTechnicalBackground,
  isPineWorkStyle,
  sanitizeCustomPronouns,
  DEFAULT_PINE_WORK_STYLE,
  type PineUserProfile,
} from "../shared/userProfile";

const PINE_SETTINGS_FILE = "pine-settings.json";

export interface PineAgentSettings {
  webServer?: WebServerSettings;
  autoApproval?: PineAutoApprovalSettings;
  diagnosticLoggingEnabled?: boolean;
  completionSignalMode?: PineCompletionSignalMode;
  attentionNotificationsEnabled?: boolean;
  quickComposerEnabled?: boolean;
  runInBackground?: boolean;
  /** Desktop only: keep the computer awake while remote control is on; absent until migrated. */
  remoteKeepAwake?: boolean;
  approximateLocationEnabled?: boolean;
  /** Long-term memory; absent means on. */
  memoryEnabled?: boolean;
  /**
   * Settings › Agent › Tools; a group absent here is on. Replaces the older
   * `computerUseEnabled` key, which reading folds into `computerUse`.
   */
  toolGroups?: Partial<PineToolGroups>;
  contextCompactionStrategy?: PineContextCompactionStrategy;
  contextCompactionRoute?: PineContextCompactionRoute;
  imageModel?: PineImageModelSelection;
  videoModel?: PineVideoModelSelection;
  utilityModel?: PineUtilityModelSelection;
  approvalModel?: PineApprovalModelSelection;
  promptRewriteModel?: PinePromptRewriteModelSelection;
  liveTranslationModel?: PineLiveTranslationModelSelection;
  userProfile?: PineUserProfile;
  /** Read providers from Pi's models.json (as written by Pi or CC Switch). */
  piProviders?: PiProvidersSetting;
}

function isPiProvidersSetting(value: unknown): value is PiProvidersSetting {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const setting = value as Record<string, unknown>;
  return (
    typeof setting.enabled === "boolean" &&
    (setting.agentDir === undefined ||
      (typeof setting.agentDir === "string" &&
        setting.agentDir.length > 0 &&
        setting.agentDir.length <= 4_096 &&
        path.isAbsolute(setting.agentDir)))
  );
}

function isModelSelection(
  value: unknown,
): value is PineUtilityModelSelection | PineImageModelSelection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const selection = value as Record<string, unknown>;
  return (
    typeof selection.providerId === "string" &&
    selection.providerId.length > 0 &&
    typeof selection.modelId === "string" &&
    selection.modelId.length > 0
  );
}

function isPineUserProfile(value: unknown): value is PineUserProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.nickname === "string" &&
    profile.nickname.length <= 100 &&
    typeof profile.personalDetails === "string" &&
    profile.personalDetails.length <= 10_000 &&
    typeof profile.customInstructions === "string" &&
    profile.customInstructions.length <= 20_000 &&
    typeof profile.communicationStyle === "string" &&
    isPineCommunicationStyle(profile.communicationStyle) &&
    typeof profile.technicalBackground === "string" &&
    isPineTechnicalBackground(profile.technicalBackground) &&
    typeof profile.interactiveAnswersEnabled === "boolean" &&
    typeof profile.interimAnswersEnabled === "boolean" &&
    typeof profile.monetMode === "boolean" &&
    typeof profile.aldineMethodologyEnabled === "boolean" &&
    isPinePronouns(profile.pronouns) &&
    typeof profile.customPronouns === "string" &&
    isPineWorkStyle(profile.workStyle)
  );
}

/**
 * Map communication styles and technical backgrounds removed from the profile
 * to a supported one, and fill defaults for newly introduced fields.
 */
function migrateUserProfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const profile = value as Record<string, unknown>;
  return {
    ...profile,
    ...(profile.communicationStyle === "monet"
      ? { communicationStyle: "neutral" }
      : {}),
    ...(profile.technicalBackground === "enthusiast"
      ? { technicalBackground: "general-user" }
      : {}),
    ...(profile.interactiveAnswersEnabled === undefined
      ? { interactiveAnswersEnabled: true }
      : {}),
    ...(profile.interimAnswersEnabled === undefined
      ? { interimAnswersEnabled: true }
      : {}),
    ...(profile.monetMode === undefined ? { monetMode: false } : {}),
    ...(typeof profile.aldineMethodologyEnabled === "boolean"
      ? {}
      : { aldineMethodologyEnabled: true }),
    // Coerced rather than only back-filled: a missing or invalid value must
    // never make the guard discard the rest of the profile.
    pronouns: isPinePronouns(profile.pronouns)
      ? profile.pronouns
      : "unspecified",
    customPronouns: sanitizeCustomPronouns(profile.customPronouns),
    workStyle: isPineWorkStyle(profile.workStyle)
      ? profile.workStyle
      : DEFAULT_PINE_WORK_STYLE,
  };
}

/**
 * The stored tool switches, keeping only known groups with boolean values.
 * Before the Tools group existed, Computer Use had its own key.
 */
function readToolGroups(
  settings: Record<string, unknown>,
): Partial<PineToolGroups> | undefined {
  const groups: Partial<PineToolGroups> = {};
  if (typeof settings.computerUseEnabled === "boolean")
    groups.computerUse = settings.computerUseEnabled;
  const stored = settings.toolGroups;
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [id, enabled] of Object.entries(stored)) {
      if (isPineToolGroupId(id) && typeof enabled === "boolean")
        groups[id] = enabled;
    }
  }
  return Object.keys(groups).length > 0 ? groups : undefined;
}

function settingsPath(agentDir: string): string {
  return path.join(agentDir, PINE_SETTINGS_FILE);
}

export async function readPineAgentSettings(
  agentDir: string,
): Promise<PineAgentSettings> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(settingsPath(agentDir), "utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const settings = parsed as Record<string, unknown>;
    const imageModel = settings.imageModel;
    const videoModel = settings.videoModel;
    const utilityModel = settings.utilityModel;
    const approvalModel = settings.approvalModel;
    const promptRewriteModel = settings.promptRewriteModel;
    const liveTranslationModel = settings.liveTranslationModel;
    const userProfile = migrateUserProfile(settings.userProfile);
    const contextCompactionStrategy = settings.contextCompactionStrategy;
    const contextCompactionRoute = settings.contextCompactionRoute;
    const toolGroups = readToolGroups(settings);
    const webServer = readWebServerSettings(settings.webServer);
    return {
      ...(webServer ? { webServer } : {}),
      ...(isPineAutoApprovalSettings(settings.autoApproval)
        ? {
            autoApproval: {
              strategy: settings.autoApproval.strategy,
              decisionsModel: settings.autoApproval.decisionsModel,
            },
          }
        : {}),
      ...(typeof settings.diagnosticLoggingEnabled === "boolean"
        ? { diagnosticLoggingEnabled: settings.diagnosticLoggingEnabled }
        : {}),
      ...(isPineCompletionSignalMode(settings.completionSignalMode)
        ? { completionSignalMode: settings.completionSignalMode }
        : // Before the sound existed this was an on/off switch for notifications.
          typeof settings.completionSignalEnabled === "boolean"
          ? {
              completionSignalMode: settings.completionSignalEnabled
                ? "notification"
                : "off",
            }
          : {}),
      ...(typeof settings.attentionNotificationsEnabled === "boolean"
        ? {
            attentionNotificationsEnabled:
              settings.attentionNotificationsEnabled,
          }
        : {}),
      ...(typeof settings.quickComposerEnabled === "boolean"
        ? { quickComposerEnabled: settings.quickComposerEnabled }
        : {}),
      ...(typeof settings.runInBackground === "boolean"
        ? { runInBackground: settings.runInBackground }
        : {}),
      ...(typeof settings.remoteKeepAwake === "boolean"
        ? { remoteKeepAwake: settings.remoteKeepAwake }
        : {}),
      ...(typeof settings.approximateLocationEnabled === "boolean"
        ? { approximateLocationEnabled: settings.approximateLocationEnabled }
        : {}),
      ...(typeof settings.memoryEnabled === "boolean"
        ? { memoryEnabled: settings.memoryEnabled }
        : {}),
      ...(toolGroups ? { toolGroups } : {}),
      ...(isPineContextCompactionStrategy(contextCompactionStrategy)
        ? { contextCompactionStrategy }
        : {}),
      ...(isPineContextCompactionRoute(contextCompactionRoute)
        ? { contextCompactionRoute }
        : {}),
      ...(isModelSelection(imageModel) ? { imageModel } : {}),
      ...(isModelSelection(videoModel) ? { videoModel } : {}),
      ...(isModelSelection(utilityModel) ? { utilityModel } : {}),
      ...(isModelSelection(approvalModel) ? { approvalModel } : {}),
      ...(isModelSelection(promptRewriteModel) ? { promptRewriteModel } : {}),
      ...(isModelSelection(liveTranslationModel)
        ? { liveTranslationModel }
        : {}),
      ...(isPineUserProfile(userProfile) ? { userProfile } : {}),
      ...(isPiProvidersSetting(settings.piProviders)
        ? {
            piProviders: {
              enabled: settings.piProviders.enabled,
              ...(settings.piProviders.agentDir
                ? { agentDir: settings.piProviders.agentDir }
                : {}),
            },
          }
        : {}),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    return {};
  }
}

export async function writeUtilityModelSelection(
  agentDir: string,
  utilityModel: PineUtilityModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { utilityModel });
}

export async function writeApprovalModelSelection(
  agentDir: string,
  approvalModel: PineApprovalModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { approvalModel });
}

export async function writePromptRewriteModelSelection(
  agentDir: string,
  promptRewriteModel: PinePromptRewriteModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { promptRewriteModel });
}

export async function writeLiveTranslationModelSelection(
  agentDir: string,
  liveTranslationModel: PineLiveTranslationModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { liveTranslationModel });
}

export async function writeImageModelSelection(
  agentDir: string,
  imageModel: PineImageModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { imageModel });
}
export async function writeVideoModelSelection(
  agentDir: string,
  videoModel: PineVideoModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { videoModel });
}

export async function writePineUserProfile(
  agentDir: string,
  userProfile: PineUserProfile,
): Promise<void> {
  await writePineAgentSettings(agentDir, { userProfile });
}

export async function writeContextCompactionStrategy(
  agentDir: string,
  contextCompactionStrategy: PineContextCompactionStrategy,
): Promise<void> {
  await writePineAgentSettings(agentDir, { contextCompactionStrategy });
}

export async function writeContextCompactionRoute(
  agentDir: string,
  contextCompactionRoute: PineContextCompactionRoute,
): Promise<void> {
  await writePineAgentSettings(agentDir, { contextCompactionRoute });
}

export async function writeDiagnosticLoggingEnabled(
  agentDir: string,
  diagnosticLoggingEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { diagnosticLoggingEnabled });
}

export async function writeCompletionSignalMode(
  agentDir: string,
  completionSignalMode: PineCompletionSignalMode,
): Promise<void> {
  await writePineAgentSettings(agentDir, { completionSignalMode });
}

export async function writeAttentionNotificationsEnabled(
  agentDir: string,
  attentionNotificationsEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { attentionNotificationsEnabled });
}

export async function writeQuickComposerEnabled(
  agentDir: string,
  quickComposerEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { quickComposerEnabled });
}

export async function writeRunInBackground(
  agentDir: string,
  runInBackground: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { runInBackground });
}

export async function writeRemoteKeepAwake(
  agentDir: string,
  remoteKeepAwake: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { remoteKeepAwake });
}

export async function writeApproximateLocationEnabled(
  agentDir: string,
  approximateLocationEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { approximateLocationEnabled });
}

export async function writeMemoryEnabled(
  agentDir: string,
  memoryEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { memoryEnabled });
}

/** Saves one tool switch, keeping the others; returns the stored switches. */
export async function writeToolGroupEnabled(
  agentDir: string,
  id: PineToolGroupId,
  enabled: boolean,
): Promise<Partial<PineToolGroups>> {
  let toolGroups: Partial<PineToolGroups> = {};
  await updatePineAgentSettingsFile(agentDir, (current) => {
    toolGroups = { ...readToolGroups(current), [id]: enabled };
    // The legacy key is folded into `toolGroups` above; drop it once written.
    const next: Record<string, unknown> = { ...current, toolGroups };
    delete next.computerUseEnabled;
    return next;
  });
  return toolGroups;
}

export async function writePiProvidersSetting(
  agentDir: string,
  piProviders: PiProvidersSetting,
): Promise<void> {
  if (!isPiProvidersSetting(piProviders)) {
    throw new Error("Invalid Pi providers setting.");
  }
  await writePineAgentSettings(agentDir, {
    piProviders: {
      enabled: piProviders.enabled,
      ...(piProviders.agentDir ? { agentDir: piProviders.agentDir } : {}),
    },
  });
}

export async function writeAutoApprovalSettings(
  agentDir: string,
  autoApproval: PineAutoApprovalSettings,
): Promise<void> {
  if (
    !isPineAutoApprovalSettings(autoApproval) ||
    (autoApproval.strategy === "decisions" &&
      !(await decisionsModelDescriptors(agentDir)).some(
        (model) => model.id === autoApproval.decisionsModel.trim(),
      ))
  ) {
    throw new Error("Invalid automatic approval settings.");
  }
  await writePineAgentSettings(agentDir, {
    autoApproval: {
      strategy: autoApproval.strategy,
      decisionsModel: autoApproval.decisionsModel.trim(),
    },
  });
}

export async function writeWebServerSettings(
  agentDir: string,
  webServer: WebServerSettings,
): Promise<void> {
  if (!isWebServerSettings(webServer))
    throw new Error("Invalid local web settings.");
  await writePineAgentSettings(agentDir, { webServer });
}

async function writePineAgentSettings(
  agentDir: string,
  patch: Partial<PineAgentSettings>,
): Promise<void> {
  await updatePineAgentSettingsFile(agentDir, (current) => ({
    ...current,
    ...patch,
  }));
}

/** The latest pending update of each settings file, in this process. */
const pendingSettingsUpdates = new Map<string, Promise<void>>();

/**
 * Rewrites the settings file from its current contents. Updates of one file
 * run one after another, so two saves made at once (two switches flipped
 * quickly, or a background model default) never drop each other's change,
 * and the file is replaced whole, so a reader never sees it half written.
 */
async function updatePineAgentSettingsFile(
  agentDir: string,
  update: (current: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const destination = settingsPath(agentDir);
  const previous = pendingSettingsUpdates.get(destination) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(agentDir, { recursive: true });
    let current: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(destination, "utf8"));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        current = parsed as Record<string, unknown>;
      }
    } catch {
      // Recreate the settings file when it is missing or malformed.
    }
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify(update(current), null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, destination);
  });
  // A failed update must not block the ones queued after it.
  const settled = next.catch(() => undefined);
  pendingSettingsUpdates.set(destination, settled);
  void settled.then(() => {
    if (pendingSettingsUpdates.get(destination) === settled)
      pendingSettingsUpdates.delete(destination);
  });
  await next;
}
