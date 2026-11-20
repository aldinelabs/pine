/**
 * Settings › Agent › Tools: switches that take a whole family of Pine's tools
 * away from the agent. The list is fixed and ordered; the agent side maps each
 * group to its tool names (`src/agent/runtime/tool-groups.ts`).
 *
 * Tools the core loop cannot work without (reading and editing files, the
 * to-do list, the clock, questions to the user) have no switch.
 */
export const PINE_TOOL_GROUP_IDS = [
  "shell",
  "web",
  "computerUse",
  "media",
  "workbench",
  "liveContext",
  "sessions",
  "projects",
  "skills",
  "automations",
  "mcp",
] as const;

export type PineToolGroupId = (typeof PINE_TOOL_GROUP_IDS)[number];

/** Every group's switch; a group absent from the settings file is on. */
export type PineToolGroups = Record<PineToolGroupId, boolean>;

export const GET_TOOL_GROUPS_CHANNEL = "preferences:get-tool-groups" as const;
export const SET_TOOL_GROUP_ENABLED_CHANNEL =
  "preferences:set-tool-group-enabled" as const;

export interface SetToolGroupEnabledRequest {
  id: PineToolGroupId;
  enabled: boolean;
}

export function isPineToolGroupId(value: unknown): value is PineToolGroupId {
  return PINE_TOOL_GROUP_IDS.some((id) => id === value);
}

/** All on: the default for new and existing users. */
export function defaultPineToolGroups(): PineToolGroups {
  return Object.fromEntries(
    PINE_TOOL_GROUP_IDS.map((id) => [id, true]),
  ) as PineToolGroups;
}

/** The full switch set from what the settings file stores. */
export function resolvePineToolGroups(
  stored: Partial<PineToolGroups> | undefined,
): PineToolGroups {
  const groups = defaultPineToolGroups();
  for (const id of PINE_TOOL_GROUP_IDS) {
    const value = stored?.[id];
    if (typeof value === "boolean") groups[id] = value;
  }
  return groups;
}
