/** Limits from the Agent Skills format, mirrored by the agent-side loader. */
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1_024;
export const SKILL_COMPATIBILITY_MAX_LENGTH = 500;

export type SkillToolLabel =
  "read" | "edit" | "write" | "shell" | "webSearch" | "webFetch";

export interface SkillToolOption {
  label: SkillToolLabel;
  tool: string;
}

export interface SkillToolGroup {
  id: "inspect" | "modify" | "run" | "web";
  options: SkillToolOption[];
}

/**
 * Built-in tools a Skill most often pre-approves, grouped by what they do.
 * The shell tool is named after the shell Pine runs on this platform.
 */
export function skillToolGroups(platform?: string): SkillToolGroup[] {
  const shell = platform === "win32" ? "powershell" : "bash";
  return [
    { id: "inspect", options: [{ label: "read", tool: "read" }] },
    {
      id: "modify",
      options: [
        { label: "edit", tool: "edit" },
        { label: "write", tool: "write" },
      ],
    },
    { id: "run", options: [{ label: "shell", tool: shell }] },
    {
      id: "web",
      options: [
        { label: "webSearch", tool: "web_search" },
        { label: "webFetch", tool: "web_fetch" },
      ],
    },
  ];
}

/** SPDX identifiers offered before falling back to a free-form license. */
export const SKILL_LICENSE_PRESETS = [
  "MIT",
  "Apache-2.0",
  "BSD-3-Clause",
  "GPL-3.0",
  "Proprietary",
] as const;

export const SKILL_TEMPLATES = ["workflow", "checklist", "reference"] as const;

export type SkillTemplate = (typeof SKILL_TEMPLATES)[number];

export type SkillNameIssue = "required" | "invalid" | "tooLong";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Turns what the user types into a valid name as they type it: lowercase,
 * spaces and underscores become hyphens, everything else is dropped. A
 * trailing hyphen survives so the next word can follow it.
 */
export function normalizeSkillNameInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-/, "")
    .slice(0, SKILL_NAME_MAX_LENGTH);
}

export function skillNameIssue(name: string): SkillNameIssue | null {
  if (!name) return "required";
  if (name.length > SKILL_NAME_MAX_LENGTH) return "tooLong";
  return SKILL_NAME_PATTERN.test(name) ? null : "invalid";
}

/** Splits the space-separated `allowed-tools` value into unique entries. */
export function parseToolList(value: string): string[] {
  return [...new Set(value.split(/\s+/).filter(Boolean))];
}

export function formatToolList(tools: readonly string[]): string {
  return [...new Set(tools.map((tool) => tool.trim()).filter(Boolean))].join(
    " ",
  );
}
