import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPineAgentSettings,
  writeAutoApprovalSettings,
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
  it("persists approval screening settings alongside existing preferences", async () => {
    const agentDir = await mkdtemp(
      path.join(os.tmpdir(), "pine-approval-settings-"),
    );
    temporaryDirectories.push(agentDir);
    await writeUtilityModelSelection(agentDir, {
      providerId: "provider",
      modelId: "review-model",
    });
    await writeAutoApprovalSettings(agentDir, {
      strategy: "decisions",
      decisionsModel: " typesafe/jev-1.13 ",
      confidenceThreshold: 0.95,
    });
    await writeDiagnosticLoggingEnabled(agentDir, true);
    await expect(readPineAgentSettings(agentDir)).resolves.toEqual({
      utilityModel: { providerId: "provider", modelId: "review-model" },
      diagnosticLoggingEnabled: true,
      autoApproval: {
        strategy: "decisions",
        decisionsModel: "typesafe/jev-1.13",
        confidenceThreshold: 0.95,
      },
    });
    await expect(
      writeAutoApprovalSettings(agentDir, {
        strategy: "decisions",
        decisionsModel: "",
        confidenceThreshold: 2,
      }),
    ).rejects.toThrow("Invalid automatic approval settings");
    await expect(
      writeAutoApprovalSettings(agentDir, {
        strategy: "decisions",
        decisionsModel: "openai/chat-model",
        confidenceThreshold: 0.66,
      }),
    ).rejects.toThrow("Invalid automatic approval settings");
    expect(
      (await readPineAgentSettings(agentDir)).autoApproval?.confidenceThreshold,
    ).toBe(0.95);
  });

  it.each([
    undefined,
    { strategy: "other", decisionsModel: "model", confidenceThreshold: 0.9 },
    {
      strategy: "decisions",
      decisionsModel: "model",
      confidenceThreshold: 1.1,
    },
    {
      strategy: "decisions",
      decisionsModel: "model",
      confidenceThreshold: 0.4,
    },
    { strategy: "decisions", decisionsModel: " ", confidenceThreshold: 0.9 },
    {
      strategy: "decisions",
      decisionsModel: "model",
      confidenceThreshold: "0.9",
    },
  ])(
    "ignores absent or invalid approval settings while preserving other settings: %j",
    async (autoApproval) => {
      const agentDir = await mkdtemp(
        path.join(os.tmpdir(), "pine-approval-invalid-"),
      );
      temporaryDirectories.push(agentDir);
      await writeFile(
        path.join(agentDir, "pine-settings.json"),
        JSON.stringify({ autoApproval, diagnosticLoggingEnabled: true }),
      );
      expect(await readPineAgentSettings(agentDir)).toEqual({
        diagnosticLoggingEnabled: true,
      });
    },
  );

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
