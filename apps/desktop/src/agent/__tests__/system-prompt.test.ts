import { describe, expect, it } from "vitest";
import {
  PINE_YOLO_SYSTEM_PROMPT,
  PINE_SYSTEM_PROMPT,
  systemPromptWithUserProfile,
  systemPromptWithCurrentMonth,
  approvalModeNotice,
  approvalModeSystemPrompt,
  systemPromptForPlatform,
} from "../system-prompt";

describe("systemPromptWithCurrentMonth", () => {
  it("appends the current year and month after the stable prompt prefix", () => {
    const prompt = systemPromptWithCurrentMonth(
      `${PINE_SYSTEM_PROMPT}\n\n<project_context>stable context</project_context>`,
      new Date("2026-09-06T12:00:00"),
    );

    expect(
      prompt.startsWith(
        `${PINE_SYSTEM_PROMPT}\n\n<project_context>stable context</project_context>`,
      ),
    ).toBe(true);
    expect(prompt).toContain("The current year and month are 2026-09.");
    expect(prompt).not.toContain("2026-09-06");
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

  it("applies the Monet communication style", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "monet",
      customInstructions: "",
      interfaceElements: "rich",
      nickname: "",
      personalDetails: "",
      technicalBackground: "general-user",
    });

    expect(prompt).toContain("### Communication style: Monet");
    expect(prompt).toContain("help people think more clearly");
    expect(prompt).toContain("Honesty over performance");
    expect(prompt).not.toContain("emotionally supportive");
    expect(prompt).not.toContain("Sóber");
  });

  it("omits the Monet guide for other communication styles", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "calm-professional",
      customInstructions: "",
      interfaceElements: "rich",
      nickname: "",
      personalDetails: "",
      technicalBackground: "general-user",
    });

    expect(prompt).not.toContain("Monet");
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
