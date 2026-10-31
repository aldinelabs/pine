import { describe, expect, it } from "vitest";
import {
  PINE_YOLO_SYSTEM_PROMPT,
  PINE_SYSTEM_PROMPT,
  systemPromptWithUserProfile,
  approvalModeNotice,
  approvalModeSystemPrompt,
  systemPromptForPlatform,
} from "../system-prompt";

describe("time rule", () => {
  it("tells the model to read the clock instead of estimating", () => {
    expect(PINE_SYSTEM_PROMPT).toContain("such as `date`");
    expect(PINE_SYSTEM_PROMPT).not.toMatch(/current year and month are/);
    expect(systemPromptForPlatform(PINE_SYSTEM_PROMPT, "win32")).toContain(
      "such as `Get-Date`",
    );
  });
});

describe("systemPromptForPlatform", () => {
  it("swaps the shell vocabulary for Windows", () => {
    const prompt = systemPromptForPlatform(PINE_SYSTEM_PROMPT, "win32");

    expect(prompt).toContain("privileged_powershell");
    expect(prompt).not.toContain("privileged_bash");
    expect(prompt).toContain("in $env:PINE_TMPDIR");
    expect(prompt).not.toContain("/tmp");
  });

  it("states the /tmp rule alongside the writable locations", () => {
    const writeRule = PINE_SYSTEM_PROMPT.split("\n").find((line) =>
      line.startsWith("- write only to"),
    );

    expect(writeRule).toContain("system /tmp is not writable");
    expect(writeRule).toContain("in $TMPDIR, never /tmp");
  });
});

describe("systemPromptWithUserProfile", () => {
  it("injects the user-authored profile fields", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "warm-friendly",
      customInstructions: "Always lead with the conclusion.",
      interfaceElements: "rich",
      nickname: "小 Pine",
      personalDetails: "正在学习桌面应用开发。",
      technicalBackground: "professional-user",
    });

    expect(prompt.startsWith("base prompt")).toBe(true);
    expect(prompt).toContain("Preferred name: 小 Pine");
    expect(prompt).toContain("Always lead with the conclusion.");
    expect(prompt).toContain("正在学习桌面应用开发。");
  });

  it("applies the neutral communication style", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "neutral",
      customInstructions: "",
      interfaceElements: "rich",
      nickname: "",
      personalDetails: "",
      technicalBackground: "general-user",
    });

    expect(prompt).toContain("balanced tone");
  });
});

describe("approvalModeSystemPrompt", () => {
  it("does not depend on the active mode", () => {
    const prompt = approvalModeSystemPrompt("darwin");
    expect(prompt).toContain(PINE_YOLO_SYSTEM_PROMPT);
    expect(prompt).not.toContain("Current mode");
    expect(approvalModeSystemPrompt("win32")).toContain(
      "call privileged_powershell directly",
    );
  });
});

describe("approvalModeNotice", () => {
  it("names the active mode and redirects shell calls only in YOLO", () => {
    expect(approvalModeNotice("autonomous", "darwin")).toContain(
      "Autonomous Work (autonomous)",
    );
    expect(approvalModeNotice("autonomous", "darwin")).not.toContain(
      "privileged_bash",
    );
    expect(approvalModeNotice("YOLO", "darwin")).toContain(
      "use privileged_bash for every shell command",
    );
    expect(approvalModeNotice("YOLO", "win32")).toContain(
      "Ordinary PowerShell calls are rejected",
    );
  });
});
