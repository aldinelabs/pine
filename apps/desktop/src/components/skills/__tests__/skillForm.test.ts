import { describe, expect, it } from "vitest";
import {
  formatToolList,
  normalizeSkillNameInput,
  parseToolList,
  skillNameIssue,
  skillToolGroups,
} from "../skillForm";

describe("skillForm", () => {
  it("normalizes typed names into the Skill name format", () => {
    expect(normalizeSkillNameInput("Release Notes")).toBe("release-notes");
    expect(normalizeSkillNameInput("my_skill  v2")).toBe("my-skill-v2");
    expect(normalizeSkillNameInput("--发布!notes")).toBe("notes");
    expect(normalizeSkillNameInput("a--b")).toBe("a-b");
    // A trailing hyphen survives so the next word can follow.
    expect(normalizeSkillNameInput("draft-")).toBe("draft-");
    expect(normalizeSkillNameInput("x".repeat(80))).toHaveLength(64);
  });

  it("reports why a name is not valid", () => {
    expect(skillNameIssue("")).toBe("required");
    expect(skillNameIssue("draft-")).toBe("invalid");
    expect(skillNameIssue("Draft")).toBe("invalid");
    expect(skillNameIssue("x".repeat(65))).toBe("tooLong");
    expect(skillNameIssue("release-notes")).toBeNull();
  });

  it("round-trips the space-separated allowed-tools value", () => {
    expect(parseToolList("  read bash\tread  Bash(git:*) ")).toEqual([
      "read",
      "bash",
      "Bash(git:*)",
    ]);
    expect(formatToolList(["read", " bash ", "", "read"])).toBe("read bash");
  });

  it("offers only tools Pine registers, with the platform's shell", () => {
    const tools = (platform?: string) =>
      skillToolGroups(platform).flatMap((group) =>
        group.options.map((option) => option.tool),
      );
    expect(tools("darwin")).toEqual([
      "read",
      "find",
      "grep",
      "edit",
      "write",
      "bash",
      "web_search",
      "web_fetch",
    ]);
    expect(tools("win32")).toContain("powershell");
    expect(tools("win32")).not.toContain("bash");
  });
});
