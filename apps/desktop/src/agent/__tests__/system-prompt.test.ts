import { describe, expect, it } from "vitest";
import {
  PINE_YOLO_SYSTEM_PROMPT,
  PINE_SYSTEM_PROMPT,
  systemPromptWithUserProfile,
  systemPromptWithCurrentMonth,
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
  });
});

describe("systemPromptWithUserProfile", () => {
  it("injects the user-authored profile fields", () => {
    const prompt = systemPromptWithUserProfile("base prompt", {
      communicationStyle: "warm-friendly",
      customInstructions: "Always lead with the conclusion.",
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
      nickname: "",
      personalDetails: "",
      technicalBackground: "enthusiast",
    });

    expect(prompt).toContain("help the user think more clearly");
    expect(prompt).not.toContain("emotionally supportive");
  });
});

describe("approvalModeSystemPrompt", () => {
  it("identifies the active mode and includes the YOLO guidance only there", () => {
    expect(approvalModeSystemPrompt("autonomous")).toContain(
      "Current mode: autonomous",
    );
    expect(approvalModeSystemPrompt("YOLO")).toContain(PINE_YOLO_SYSTEM_PROMPT);
    expect(approvalModeSystemPrompt("autonomous")).not.toContain(
      PINE_YOLO_SYSTEM_PROMPT,
    );
  });
});
