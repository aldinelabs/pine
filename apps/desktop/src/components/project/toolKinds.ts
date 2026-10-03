import {
  BookOpenIcon,
  ClapperboardIcon,
  EyeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderTreeIcon,
  GlobeIcon,
  HistoryIcon,
  ListTodoIcon,
  MonitorCogIcon,
  PanelTopIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  SquareTerminal,
  Trash2Icon,
  WandSparklesIcon,
  WorkflowIcon,
  WrenchIcon,
} from "@lucide/vue";
import type { Component } from "vue";
import { TODO_TOOL_NAME } from "@pine/rpiv-todo";
import { BACKGROUND_TASK_TOOL_NAMES } from "@pine/pi-background-tasks";
import {
  UI_PRESENT_FILE_TOOL_NAME,
  VCC_RECALL_TOOL_NAME,
} from "@/shared/agent";
import type { PineToolCall } from "@/shared/sessions";

export type ToolKind =
  | "background"
  | "bash"
  | "browser"
  | "computer"
  | "edit"
  | "fetch"
  | "generic"
  | "media"
  | "mcp"
  | "presentFile"
  | "read"
  | "recall"
  | "search"
  | "skill"
  | "todo"
  | "write";

/** Icon shown for each tool call, keyed by its kind. */
export const TOOL_KIND_ICON: Record<ToolKind, Component> = {
  background: WorkflowIcon,
  bash: SquareTerminal,
  browser: PanelTopIcon,
  computer: MonitorCogIcon,
  edit: SquarePenIcon,
  fetch: GlobeIcon,
  generic: WrenchIcon,
  media: ClapperboardIcon,
  mcp: PlugIcon,
  presentFile: EyeIcon,
  read: FileTextIcon,
  recall: HistoryIcon,
  search: SearchIcon,
  skill: WandSparklesIcon,
  todo: ListTodoIcon,
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

export type MediaOperation = "activateMediaGeneration" | "generateImage";

/** Icons shown for the dynamically activated media generation tools. */
export const MEDIA_OPERATION_ICON: Record<MediaOperation, Component> = {
  activateMediaGeneration: ClapperboardIcon,
  generateImage: WandSparklesIcon,
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
  "todo",
  "media",
  "mcp",
  "computer",
  "browser",
  "bash",
  "background",
  "skill",
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
};

export function skillOperationKey(name: string): SkillOperation | undefined {
  return SKILL_OPERATION_KEYS[name.toLowerCase().split(/[.:/]/).at(-1) ?? name];
}

export function mediaOperationKey(name: string): MediaOperation | undefined {
  return MEDIA_OPERATION_KEYS[name.toLowerCase().split(/[.:/]/).at(-1) ?? name];
}

/** Resolve the most specific icon for a tool call, including Skill operations. */
export function toolIconForName(name: string): Component {
  const skillOperation = skillOperationKey(name);
  if (skillOperation) return SKILL_OPERATION_ICON[skillOperation];
  const mediaOperation = mediaOperationKey(name);
  if (mediaOperation) return MEDIA_OPERATION_ICON[mediaOperation];
  return TOOL_KIND_ICON[toolKind(name)];
}

export function toolKind(name: string): ToolKind {
  const normalized = name.toLowerCase().split(/[.:/]/).at(-1) ?? name;
  if (
    normalized === "mcp" ||
    normalized === "mcpscript" ||
    normalized.startsWith("mcp__")
  )
    return "mcp";
  if (normalized === UI_PRESENT_FILE_TOOL_NAME) return "presentFile";
  if (normalized === TODO_TOOL_NAME) return "todo";
  if (normalized === VCC_RECALL_TOOL_NAME) return "recall";
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
