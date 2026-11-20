import {
  BG_KILL_TOOL_NAME,
  BG_LOGS_TOOL_NAME,
  BG_RUN_TOOL_NAME,
  BG_STATUS_TOOL_NAME,
} from "@pine/pi-background-tasks";
import {
  UI_PRESENT_FILE_TOOL_NAME,
  UI_PROJECT_CREATE_TOOL_NAME,
  UI_PROJECT_DELETE_TOOL_NAME,
  UI_PROJECT_LIST_TOOL_NAME,
  UI_PROJECT_UPDATE_TOOL_NAME,
  UI_SESSION_DELETE_TOOL_NAME,
  UI_SESSION_NEW_TOOL_NAME,
  UI_SESSION_ORGANIZE_TOOL_NAME,
  UI_SESSION_READ_TOOL_NAME,
  UI_SESSION_RELATIVES_TOOL_NAME,
  UI_SESSION_RENAME_TOOL_NAME,
  UI_SESSION_SEARCH_TOOL_NAME,
  UI_SESSION_SEND_TOOL_NAME,
  UI_SESSION_STOP_TOOL_NAME,
  UI_SESSION_TELEPORT_TOOL_NAME,
  UI_SESSION_TREE_TOOL_NAME,
  UI_SUBMIT_ARTIFACT_TOOL_NAME,
} from "../../shared/agent";
import {
  LIVE_CONTEXT_CAPTURE_TOOL_NAME,
  READ_LIVE_TRANSCRIPT_TOOL_NAME,
} from "../../shared/liveContextAgent";
import { MCP_AUTHORING_DYNAMIC_TOOL_NAMES } from "../../shared/mcp";
import {
  ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
  ACTIVATE_MCP_AUTHORING_TOOL_NAME,
  ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
} from "../../shared/sessionMutators";
import {
  PINE_TOOL_GROUP_IDS,
  type PineToolGroupId,
  type PineToolGroups,
} from "../../shared/toolGroups";
import { UI_WORKBENCH_TOOL_NAMES } from "../../shared/workbench";
import { AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES } from "../automation/tools";
import {
  ACTIVATE_COMPUTER_USE_TOOL_NAME,
  COMPUTER_USE_DYNAMIC_TOOL_NAMES,
} from "../computer-use/tools";
import {
  ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
  MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
} from "../media/tools";
import {
  INVOKE_SKILL_TOOL_NAME,
  LIST_SKILL_RESOURCES_TOOL_NAME,
  READ_SKILL_RESOURCE_TOOL_NAME,
  SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
} from "../skills/tools";
import { TINYFISH_TOOL_NAMES } from "../tinyfishTools";

/**
 * The tools each Settings › Agent › Tools switch takes away. MCP server tools
 * are named by their servers, so `mcp` also covers every tool the MCP adapter
 * registers; the names here are its authoring tools.
 */
export const TOOL_GROUP_TOOL_NAMES: Readonly<
  Record<PineToolGroupId, readonly string[]>
> = {
  shell: [
    "bash",
    "powershell",
    "privileged_bash",
    "privileged_powershell",
    BG_RUN_TOOL_NAME,
    BG_STATUS_TOOL_NAME,
    BG_LOGS_TOOL_NAME,
    BG_KILL_TOOL_NAME,
  ],
  web: TINYFISH_TOOL_NAMES,
  computerUse: [
    ACTIVATE_COMPUTER_USE_TOOL_NAME,
    ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
  ],
  media: [
    ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
    ...MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
  ],
  workbench: [
    UI_SUBMIT_ARTIFACT_TOOL_NAME,
    UI_PRESENT_FILE_TOOL_NAME,
    ...UI_WORKBENCH_TOOL_NAMES,
  ],
  liveContext: [READ_LIVE_TRANSCRIPT_TOOL_NAME, LIVE_CONTEXT_CAPTURE_TOOL_NAME],
  sessions: [
    UI_SESSION_SEARCH_TOOL_NAME,
    UI_SESSION_NEW_TOOL_NAME,
    UI_SESSION_TREE_TOOL_NAME,
    UI_SESSION_ORGANIZE_TOOL_NAME,
    UI_SESSION_RENAME_TOOL_NAME,
    UI_SESSION_RELATIVES_TOOL_NAME,
    UI_SESSION_READ_TOOL_NAME,
    UI_SESSION_SEND_TOOL_NAME,
    UI_SESSION_STOP_TOOL_NAME,
    UI_SESSION_DELETE_TOOL_NAME,
    UI_SESSION_TELEPORT_TOOL_NAME,
  ],
  projects: [
    UI_PROJECT_LIST_TOOL_NAME,
    UI_PROJECT_CREATE_TOOL_NAME,
    UI_PROJECT_UPDATE_TOOL_NAME,
    UI_PROJECT_DELETE_TOOL_NAME,
  ],
  skills: [
    INVOKE_SKILL_TOOL_NAME,
    LIST_SKILL_RESOURCES_TOOL_NAME,
    READ_SKILL_RESOURCE_TOOL_NAME,
    ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
    ...SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
  ],
  automations: [
    ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
    ...AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
  ],
  mcp: [ACTIVATE_MCP_AUTHORING_TOOL_NAME, ...MCP_AUTHORING_DYNAMIC_TOOL_NAMES],
};

/** How the model hears of a switched-off group; matches the English label. */
const TOOL_GROUP_NOTICE_LABEL: Readonly<Record<PineToolGroupId, string>> = {
  shell: "Shell commands",
  web: "Web search",
  computerUse: "Computer use",
  media: "Image and video generation",
  workbench: "Artifacts and workbench",
  liveContext: "Live Context",
  sessions: "Sessions",
  projects: "Projects",
  skills: "Skills",
  automations: "Automations",
  mcp: "MCP servers",
};

/**
 * Drops the tools of every switched-off group. Filtering keeps the order of
 * `toolNames`, so one switch set always yields the same tool list.
 */
export function toolNamesForToolGroups(
  toolNames: readonly string[],
  groups: PineToolGroups,
  mcpToolNames: readonly string[] = [],
): string[] {
  const hidden = new Set<string>();
  for (const id of PINE_TOOL_GROUP_IDS) {
    if (groups[id]) continue;
    for (const name of TOOL_GROUP_TOOL_NAMES[id]) hidden.add(name);
    if (id === "mcp") for (const name of mcpToolNames) hidden.add(name);
  }
  return toolNames.filter((name) => !hidden.has(name));
}

/**
 * `toolNames` sorted by their place in `order`; names `order` lacks keep
 * their relative order after the rest. The sort is stable, so the result
 * depends only on the set of names, not on how they were arrived at.
 */
export function inToolOrder(
  toolNames: readonly string[],
  order: readonly string[],
): string[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return toolNames
    .map((name, index) => ({ name, index }))
    .sort(
      (a, b) =>
        (rank.get(a.name) ?? order.length + a.index) -
        (rank.get(b.name) ?? order.length + b.index),
    )
    .map(({ name }) => name);
}

/**
 * The context notice naming the switched-off groups, or undefined when all
 * are on. Pine's fixed system prompt and earlier messages may still mention
 * those tools; the notice tells the model they are gone and where the user
 * turns them back on, without touching the cached prompt.
 */
export function disabledToolsNotice(
  groups: PineToolGroups,
  registeredToolNames: readonly string[],
): string | undefined {
  const registered = new Set(registeredToolNames);
  const lines = PINE_TOOL_GROUP_IDS.filter((id) => !groups[id]).map((id) => {
    const names = TOOL_GROUP_TOOL_NAMES[id].filter((name) =>
      registered.has(name),
    );
    const label = TOOL_GROUP_NOTICE_LABEL[id];
    const scope = id === "mcp" ? ["every MCP server tool", ...names] : names;
    return scope.length > 0 ? `- ${label}: ${scope.join(", ")}` : `- ${label}`;
  });
  if (lines.length === 0) return undefined;
  return [
    "The user turned these Pine capabilities off in Settings › Agent › Tools, so their tools are not available:",
    ...lines,
    "Disregard instructions elsewhere that rely on these tools and work with the tools you have. If the user asks for one of these capabilities, tell them it is turned off and that they can turn it back on in Settings › Agent › Tools.",
  ].join("\n");
}
