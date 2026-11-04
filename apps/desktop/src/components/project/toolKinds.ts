import {
  AppWindowIcon,
  BookOpenIcon,
  CalendarClockIcon,
  ClapperboardIcon,
  CpuIcon,
  EyeIcon,
  FilePlusIcon,
  FolderInputIcon,
  FolderSearchIcon,
  FileTextIcon,
  FolderTreeIcon,
  GlobeIcon,
  HistoryIcon,
  ListTodoIcon,
  MonitorCogIcon,
  PanelRightIcon,
  PanelTopIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  ServerCogIcon,
  SquarePenIcon,
  SquareTerminal,
  Trash2Icon,
  WandSparklesIcon,
  WorkflowIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import {
  UI_WORKBENCH_STATE_TOOL_NAME,
  UI_WORKBENCH_TOOL_NAMES,
} from "@/shared/workbench";
import { TODO_TOOL_NAME } from "@pine/rpiv-todo";
import { BACKGROUND_TASK_TOOL_NAMES } from "@pine/pi-background-tasks";
import {
  ACTIVATE_PINE_OPS_TOOL_NAME,
  RECALL_TOOL_NAME,
  UI_LIST_PROJECT_TOOL_NAME,
  UI_PRESENT_FILE_TOOL_NAME,
  UI_LIST_MODELS_TOOL_NAME,
  UI_TELEPORT_TOOL_NAME,
} from "@/shared/agent";
import { ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME } from "@/shared/automation";
import {
  MCP_CONFIG_LIST_TOOL_NAME,
  MCP_CONFIG_REMOVE_TOOL_NAME,
  MCP_CONFIG_SAVE_TOOL_NAME,
  MCP_CONFIG_SET_ENABLED_TOOL_NAME,
} from "@/shared/mcp";
import { ACTIVATE_MCP_AUTHORING_TOOL_NAME } from "@/shared/sessionMutators";
import type { PineToolCall } from "@/shared/sessions";

export type ToolKind =
  | "automation"
  | "background"
  | "bash"
  | "browser"
  | "computer"
  | "edit"
  | "fetch"
  | "generic"
  | "media"
  | "mcp"
  | "mcpConfig"
  | "model"
  | "presentFile"
  | "project"
  | "read"
  | "recall"
  | "search"
  | "skill"
  | "todo"
  | "workbench"
  | "workbenchState"
  | "write";

/** Icon shown for each tool call, keyed by its kind. */
export const TOOL_KIND_ICON: Record<ToolKind, Component> = {
  automation: CalendarClockIcon,
  background: WorkflowIcon,
  bash: SquareTerminal,
  browser: PanelTopIcon,
  computer: MonitorCogIcon,
  edit: SquarePenIcon,
  fetch: GlobeIcon,
  generic: WrenchIcon,
  media: ClapperboardIcon,
  mcp: PlugIcon,
  mcpConfig: ServerCogIcon,
  model: CpuIcon,
  presentFile: EyeIcon,
  project: FolderInputIcon,
  read: FileTextIcon,
  recall: HistoryIcon,
  search: SearchIcon,
  skill: WandSparklesIcon,
  todo: ListTodoIcon,
  workbench: PanelRightIcon,
  workbenchState: PanelRightIcon,
  write: FilePlusIcon,
};

export type SkillOperation =
  | "activateAuthoring"
  | "create"
  | "edit"
  | "invoke"
  | "listResources"
  | "readResource"
  | "remove";

/** Icons shown for the individual dynamically activated Skill operations. */
export const SKILL_OPERATION_ICON: Record<SkillOperation, Component> = {
  activateAuthoring: WandSparklesIcon,
  create: PlusIcon,
  edit: SquarePenIcon,
  invoke: BookOpenIcon,
  listResources: FolderTreeIcon,
  readResource: FileTextIcon,
  remove: Trash2Icon,
};

export type MediaOperation =
  | "activateMediaGeneration"
  | "generateImage"
  | "generateVideo"
  | "getVideoGeneration"
  | "listVideoModels";

/** Icons shown for the dynamically activated media generation tools. */
export const MEDIA_OPERATION_ICON: Record<MediaOperation, Component> = {
  activateMediaGeneration: ClapperboardIcon,
  generateImage: WandSparklesIcon,
  generateVideo: ClapperboardIcon,
  getVideoGeneration: HistoryIcon,
  listVideoModels: ClapperboardIcon,
};

/** Order used to render a tool run's summary, matching the user's example
 * ("read 3 files, edited 2, ran 5 commands"). */
export const TOOL_KIND_ORDER: readonly ToolKind[] = [
  "read",
  "edit",
  "write",
  "search",
  "recall",
  "fetch",
  "presentFile",
  "workbench",
  "workbenchState",
  "todo",
  "media",
  "mcp",
  "mcpConfig",
  "computer",
  "browser",
  "bash",
  "background",
  "skill",
  "automation",
  "model",
  "project",
  "generic",
];

const SKILL_OPERATION_KEYS: Record<string, SkillOperation> = {
  activate_skill_authoring: "activateAuthoring",
  create_skill: "create",
  edit_skill: "edit",
  invoke_skill: "invoke",
  list_skill_resources: "listResources",
  read_skill_resource: "readResource",
  remove_skill: "remove",
};

const MEDIA_OPERATION_KEYS: Record<string, MediaOperation> = {
  activate_media_generation: "activateMediaGeneration",
  generate_image: "generateImage",
  generate_video: "generateVideo",
  get_video_generation: "getVideoGeneration",
  list_video_models: "listVideoModels",
};

export function skillOperationKey(name: string): SkillOperation | undefined {
  return SKILL_OPERATION_KEYS[name.toLowerCase().split(/[.:/]/).at(-1) ?? name];
}

export function mediaOperationKey(name: string): MediaOperation | undefined {
  return MEDIA_OPERATION_KEYS[name.toLowerCase().split(/[.:/]/).at(-1) ?? name];
}

/** Resolve the most specific icon for a tool call, including Skill operations. */
export function toolIconForName(name: string): Component {
  if (normalizedName(name) === UI_LIST_PROJECT_TOOL_NAME)
    return FolderSearchIcon;
  if (normalizedName(name) === ACTIVATE_PINE_OPS_TOOL_NAME)
    return AppWindowIcon;
  const skillOperation = skillOperationKey(name);
  if (skillOperation) return SKILL_OPERATION_ICON[skillOperation];
  const mediaOperation = mediaOperationKey(name);
  if (mediaOperation) return MEDIA_OPERATION_ICON[mediaOperation];
  return TOOL_KIND_ICON[toolKind(name)];
}

function normalizedName(name: string): string {
  return name.toLowerCase().split(/[.:/]/).at(-1) ?? name;
}

export function toolKind(name: string): ToolKind {
  const normalized = normalizedName(name);
  if (
    normalized === "mcp" ||
    normalized === "mcpscript" ||
    normalized.startsWith("mcp__")
  )
    return "mcp";
  if (normalized === UI_PRESENT_FILE_TOOL_NAME) return "presentFile";
  if (normalized === UI_WORKBENCH_STATE_TOOL_NAME) return "workbenchState";
  if ((UI_WORKBENCH_TOOL_NAMES as readonly string[]).includes(normalized))
    return "workbench";
  if (
    normalized === UI_LIST_PROJECT_TOOL_NAME ||
    normalized === UI_TELEPORT_TOOL_NAME
  )
    return "project";
  if (
    normalized === ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME ||
    normalized.startsWith("automation_")
  )
    return "automation";
  if (
    normalized === ACTIVATE_MCP_AUTHORING_TOOL_NAME ||
    normalized.startsWith("mcp_config_")
  )
    return "mcpConfig";
  if (normalized === UI_LIST_MODELS_TOOL_NAME) return "model";
  if (normalized === TODO_TOOL_NAME) return "todo";
  if (normalized === RECALL_TOOL_NAME) return "recall";
  if ((BACKGROUND_TASK_TOOL_NAMES as readonly string[]).includes(normalized))
    return "background";
  if (normalized.startsWith("browser_")) return "browser";
  if (
    [
      "activate_computer_use",
      "request_computer_use_permissions",
      "install_pine_browser_extension",
      "list_apps",
      "get_app_state",
      "click",
      "right_click",
      "hover",
      "drag",
      "scroll",
      "type_text",
      "set_value",
      "select_text",
      "press_key",
      "activate_app",
      "screenshot",
      "zoom",
      "list_displays",
      "wait",
    ].includes(normalized)
  ) {
    return "computer";
  }
  if (
    [
      "bash",
      "powershell",
      "privileged_bash",
      "privileged_powershell",
      "exec",
      "execute",
      "shell",
    ].includes(normalized)
  ) {
    return "bash";
  }
  if (["edit", "apply_patch", "patch"].includes(normalized)) return "edit";
  if (["web_fetch", "fetch"].includes(normalized)) return "fetch";
  if (["read", "read_file", "view"].includes(normalized)) return "read";
  if (["find", "grep", "search", "web_search"].includes(normalized)) {
    return "search";
  }
  if (["write", "write_file", "create_file"].includes(normalized)) {
    return "write";
  }
  if (skillOperationKey(normalized)) return "skill";
  if (mediaOperationKey(normalized)) return "media";
  return "generic";
}

export type AutomationOperation =
  | "activate"
  | "check"
  | "create"
  | "delete"
  | "get"
  | "list"
  | "pause"
  | "report"
  | "resume"
  | "runNow"
  | "update";

/** Which automation tool a call is, telling a create from an update and a
 * pause from a resume by the call's arguments. */
export function automationOperation(
  name: string,
  input: Record<string, unknown>,
): AutomationOperation {
  switch (normalizedName(name)) {
    case ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME:
      return "activate";
    case "automation_check":
      return "check";
    case "automation_save":
      return typeof input.id === "string" ? "update" : "create";
    case "automation_delete":
      return "delete";
    case "automation_get":
      return "get";
    case "automation_set_enabled":
      return input.enabled === false ? "pause" : "resume";
    case "automation_run_now":
      return "runNow";
    case "automation_report":
      return "report";
    default:
      return "list";
  }
}

export type McpConfigOperation =
  "activate" | "create" | "disable" | "enable" | "list" | "remove" | "update";

/** Which MCP configuration tool a call is. A save that replaced a server, or
 * renames one, is an update; the host says which once it has saved. */
export function mcpConfigOperation(
  name: string,
  input: Record<string, unknown>,
  output?: unknown,
): McpConfigOperation {
  switch (normalizedName(name)) {
    case ACTIVATE_MCP_AUTHORING_TOOL_NAME:
      return "activate";
    case MCP_CONFIG_SAVE_TOOL_NAME: {
      const details =
        typeof output === "object" && output !== null
          ? (output as { details?: { created?: unknown } }).details
          : undefined;
      return typeof input.previousName === "string" ||
        details?.created === false
        ? "update"
        : "create";
    }
    case MCP_CONFIG_SET_ENABLED_TOOL_NAME:
      return input.enabled === false ? "disable" : "enable";
    case MCP_CONFIG_REMOVE_TOOL_NAME:
      return "remove";
    case MCP_CONFIG_LIST_TOOL_NAME:
    default:
      return "list";
  }
}

export function isRunningTool(toolCall: PineToolCall): boolean {
  return (
    !isDeniedTool(toolCall) &&
    (toolCall.status === "pending" || toolCall.status === "running")
  );
}

export function isDeniedTool(toolCall: PineToolCall): boolean {
  return toolCall.approval?.state === "denied";
}

/** Count tool calls grouped by kind, preserving only kinds that appear. */
export function countToolKinds(
  toolCalls: readonly PineToolCall[],
): Map<ToolKind, number> {
  const counts = new Map<ToolKind, number>();
  for (const toolCall of toolCalls) {
    const kind = toolKind(toolCall.name);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}
