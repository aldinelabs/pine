import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPineAgentSettings,
  writeContextCompactionStrategy,
  writeDiagnosticLoggingEnabled,
  writePineUserProfile,
  writeUtilityModelSelection,
} from "../pineSettings";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Pine agent settings", () => {
  it("persists diagnostic logging without replacing other preferences", async () => {
    const agentDir = await mkdtemp(
      path.join(os.tmpdir(), "pine-logging-settings-"),
    );
    temporaryDirectories.push(agentDir);
    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({});
    await writeContextCompactionStrategy(agentDir, "passive");
    await writeDiagnosticLoggingEnabled(agentDir, true);
    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      contextCompactionStrategy: "passive",
      diagnosticLoggingEnabled: true,
    });
    await writeDiagnosticLoggingEnabled(agentDir, false);
    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      contextCompactionStrategy: "passive",
      diagnosticLoggingEnabled: false,
    });
  });
  it("persists the context compaction strategy", async () => {
    const agentDir = await mkdtemp(
      path.join(os.tmpdir(), "pine-agent-settings-compaction-"),
    );
    temporaryDirectories.push(agentDir);

    await writeContextCompactionStrategy(agentDir, "recommended");
    await writeContextCompactionStrategy(agentDir, "passive");

    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      contextCompactionStrategy: "passive",
    });
  });

  it("persists the utility model independently from session settings", async () => {
    const agentDir = await mkdtemp(
      path.join(os.tmpdir(), "pine-agent-settings-"),
    );
    temporaryDirectories.push(agentDir);

    await writeUtilityModelSelection(agentDir, {
      providerId: "provider",
      modelId: "utility-model",
    });
    await writeUtilityModelSelection(agentDir, {
      providerId: "provider",
      modelId: "replacement-model",
    });

    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      utilityModel: {
        providerId: "provider",
        modelId: "replacement-model",
      },
    });
  });

  it("preserves the utility model when saving a user profile", async () => {
    const agentDir = await mkdtemp(
      path.join(os.tmpdir(), "pine-agent-settings-profile-"),
    );
    temporaryDirectories.push(agentDir);

    await writeUtilityModelSelection(agentDir, {
      providerId: "provider",
      modelId: "utility-model",
    });
    await writePineUserProfile(agentDir, {
      communicationStyle: "warm-friendly",
      customInstructions: "Lead with the result.",
      nickname: "Pine user",
      personalDetails: "Enjoys learning by doing.",
      technicalBackground: "enthusiast",
    });

    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      utilityModel: {
        providerId: "provider",
        modelId: "utility-model",
      },
      userProfile: {
        communicationStyle: "warm-friendly",
        customInstructions: "Lead with the result.",
        nickname: "Pine user",
        personalDetails: "Enjoys learning by doing.",
        technicalBackground: "enthusiast",
      },
    });
  });
});
