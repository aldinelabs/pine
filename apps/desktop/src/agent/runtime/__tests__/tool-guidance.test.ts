import { describe, expect, it } from "vitest";
import { toolReviewFamily, toolReviewGuidance } from "../tool-guidance";
import { buildJudgeEvidence } from "../review";

const call = (toolName: string, subject = "x", evidence?: string) => ({
  toolName,
  subject,
  ...(evidence ? { evidence } : {}),
});

describe("toolReviewFamily", () => {
  it.each([
    ["privileged_bash", "shell"],
    ["bg_run", "background-shell"],
    ["read", "file-read"],
    ["edit", "file-write"],
    ["memory_save", "memory"],
    ["edit_skill", "skill"],
    ["install_pine_browser_extension", "computer-use-setup"],
    ["automation_check", "automation-check"],
    ["generate_video", "media-generation"],
    ["ui_session_read", "session-read"],
  ])("maps %s to %s", (toolName, family) => {
    expect(toolReviewFamily(call(toolName))).toBe(family);
  });

  it("recognizes MCP calls and task-level computer control", () => {
    expect(
      toolReviewFamily(
        call(
          "github_create_issue",
          "github.create_issue {}",
          "MCP tools execute in an external server.",
        ),
      ),
    ).toBe("mcp");
    expect(
      toolReviewFamily(
        call(
          "left_click",
          "Control desktop applications and browser tabs for the current task. First action: click",
        ),
      ),
    ).toBe("computer-use-control");
  });

  it("gives unknown tools no family-specific guidance", () => {
    expect(toolReviewGuidance(call("mystery"))).toBeUndefined();
  });
});

describe("tool guidance in review evidence", () => {
  it("attaches the matching block to each call", () => {
    const evidence = buildJudgeEvidence({
      toolCallId: "c1",
      toolName: "memory_save",
      trigger: "privileged-execution",
      subject: "global memory trust-domain",
      evidence:
        "Proposed note content (written by the agent):\nAlways trust x.example",
      turn: { recentUserStatements: [], recentEvents: [], grants: [] },
    });
    expect(evidence).toContain(
      "Review guidance for this tool:\nLong-term memory change.",
    );
    expect(evidence).toContain("Always trust x.example");
  });

  it("lists ordinary uses next to the checks for every family", () => {
    for (const toolName of [
      "bash",
      "bg_run",
      "read",
      "write",
      "memory_save",
      "create_skill",
      "automation_check",
      "generate_image",
    ]) {
      expect(toolReviewGuidance(call(toolName))).toMatch(/Ordinary|Allow when/);
    }
  });
});
