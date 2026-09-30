import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decisionsModelDescriptors } from "./runtime/decisions-models";
import type {
  PineImageModelSelection,
  PineUtilityModelSelection,
} from "../shared/models";
import {
  isPineAutoApprovalSettings,
  type PineAutoApprovalSettings,
  isPineContextCompactionStrategy,
  type PineContextCompactionStrategy,
} from "../shared/preferences";
import {
  isPineCommunicationStyle,
  isPineTechnicalBackground,
  type PineUserProfile,
} from "../shared/userProfile";

const PINE_SETTINGS_FILE = "pine-settings.json";

export interface PineAgentSettings {
  autoApproval?: PineAutoApprovalSettings;
  diagnosticLoggingEnabled?: boolean;
  contextCompactionStrategy?: PineContextCompactionStrategy;
  imageModel?: PineImageModelSelection;
  utilityModel?: PineUtilityModelSelection;
  userProfile?: PineUserProfile;
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
    isPineTechnicalBackground(profile.technicalBackground)
  );
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
    const utilityModel = settings.utilityModel;
    const userProfile = settings.userProfile;
    const contextCompactionStrategy = settings.contextCompactionStrategy;
    return {
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
      ...(isPineContextCompactionStrategy(contextCompactionStrategy)
        ? { contextCompactionStrategy }
        : {}),
      ...(isModelSelection(imageModel) ? { imageModel } : {}),
      ...(isModelSelection(utilityModel) ? { utilityModel } : {}),
      ...(isPineUserProfile(userProfile) ? { userProfile } : {}),
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

export async function writeImageModelSelection(
  agentDir: string,
  imageModel: PineImageModelSelection,
): Promise<void> {
  await writePineAgentSettings(agentDir, { imageModel });
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

export async function writeDiagnosticLoggingEnabled(
  agentDir: string,
  diagnosticLoggingEnabled: boolean,
): Promise<void> {
  await writePineAgentSettings(agentDir, { diagnosticLoggingEnabled });
}

export async function writeAutoApprovalSettings(
  agentDir: string,
  autoApproval: PineAutoApprovalSettings,
): Promise<void> {
  if (
    !isPineAutoApprovalSettings(autoApproval) ||
    !(await decisionsModelDescriptors(agentDir)).some(
      (model) => model.id === autoApproval.decisionsModel.trim(),
    )
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

async function writePineAgentSettings(
  agentDir: string,
  patch: Partial<PineAgentSettings>,
): Promise<void> {
  await mkdir(agentDir, { recursive: true });
  const destination = settingsPath(agentDir);
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
  await writeFile(
    destination,
    `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`,
    "utf8",
  );
}
