import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  UI_PROJECT_CREATE_TOOL_NAME,
  UI_PROJECT_DELETE_TOOL_NAME,
  UI_PROJECT_LIST_TOOL_NAME,
  UI_PROJECT_UPDATE_TOOL_NAME,
} from "../shared/agent";
import {
  PROJECT_COLOR_THEME_SETTINGS,
  PROJECT_ICONS,
  type ProjectColorThemeSetting,
  type ProjectIcon,
} from "../shared/projects";
import type {
  AgentHostProject,
  AgentProjectFolder,
  GateDecision,
  ProjectHostOperation,
  ProjectHostResult,
} from "./protocol";
import type { PineSessionToolContext } from "./sessionTools";

export type PineProjectToolContext = Pick<
  PineSessionToolContext,
  "requestHost" | "requestApproval"
>;

async function callProjectHost<Op extends ProjectHostOperation["op"]>(
  context: PineProjectToolContext,
  operation: Extract<ProjectHostOperation, { op: Op }>,
): Promise<Extract<ProjectHostResult, { op: Op }>> {
  const response = await context.requestHost({ kind: "project", operation });
  if (response.kind !== "project" || response.result.op !== operation.op)
    throw new Error("Pine returned an unexpected project result.");
  return response.result as Extract<ProjectHostResult, { op: Op }>;
}

async function findProject(
  context: PineProjectToolContext,
  projectId: string,
): Promise<AgentHostProject> {
  const response = await context.requestHost({ kind: "list-projects" });
  if (response.kind !== "list-projects")
    throw new Error("Pine returned an unexpected project list.");
  const project = response.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project)
    throw new Error(
      `No project has id ${projectId}. Call ${UI_PROJECT_LIST_TOOL_NAME} for the current list.`,
    );
  return project;
}

/**
 * A plain string enum, like pi-ai's `StringEnum`: some providers reject the
 * `anyOf` of literals that `Type.Union` produces.
 */
function stringEnum<const T extends readonly string[]>(
  values: T,
  options: { description?: string } = {},
) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: [...values],
    ...options,
  });
}

/** The Edit Project dialog's en-US labels for each accent colour. */
const ACCENT_COLOR_LABELS: Record<ProjectColorThemeSetting, string> = {
  default: "Pine Default",
  neutral: "Neutral",
  olive: "Olive",
  red: "Red",
  rose: "Rose",
  orange: "Orange",
  green: "Green",
  blue: "Blue",
  yellow: "Yellow",
  violet: "Violet",
};

const iconSchema = stringEnum(PROJECT_ICONS, {
  description:
    "Lucide icon shown for the project in the sidebar and pickers. Pine's default is inbox.",
});
const accentColorSchema = stringEnum(PROJECT_COLOR_THEME_SETTINGS, {
  description:
    "The project's accent color. default follows Pine's default color theme from Settings > Appearance (shown as Pine Default); the other values give the project its own palette.",
});

function checkedIcon(value: string | undefined): ProjectIcon | undefined {
  if (value === undefined) return undefined;
  if (!(PROJECT_ICONS as readonly string[]).includes(value))
    throw new Error(
      `Unknown icon "${value}". Use one of: ${PROJECT_ICONS.join(", ")}.`,
    );
  return value as ProjectIcon;
}

function checkedAccentColor(
  value: string | undefined,
): ProjectColorThemeSetting | undefined {
  if (value === undefined) return undefined;
  if (!(PROJECT_COLOR_THEME_SETTINGS as readonly string[]).includes(value))
    throw new Error(
      `Unknown accent color "${value}". Use one of: ${PROJECT_COLOR_THEME_SETTINGS.join(", ")}.`,
    );
  return value as ProjectColorThemeSetting;
}

const folderSchema = Type.Object({
  path: Type.String({ description: "Absolute path of an existing folder." }),
  readOnly: Type.Optional(
    Type.Boolean({ description: "Pine may read but not change it." }),
  ),
});

function agentFolders(
  folders: readonly Static<typeof folderSchema>[],
): AgentProjectFolder[] {
  return folders.map((folder) => ({
    path: folder.path.trim(),
    access: folder.readOnly ? "read-only" : "read-write",
  }));
}

function folderLine(folder: AgentProjectFolder): string {
  return `${folder.path}${folder.access === "read-only" ? " (read-only)" : ""}`;
}

function declined(decision: GateDecision, what: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `The user did not ${what}.${decision.kind === "deny" && decision.reason ? ` ${decision.reason}` : ""}`,
      },
    ],
    details: { done: false },
  };
}

/**
 * Pine managing the user's projects. Each call changes what the agent may
 * touch on disk, so the user confirms every one of them in every approval
 * mode, YOLO included; main refuses changes that would end running work.
 */
export function createProjectToolDefinitions(
  context: PineProjectToolContext,
): ToolDefinition[] {
  const createParams = Type.Object({
    name: Type.String(),
    folders: Type.Array(folderSchema, {
      minItems: 1,
      description:
        "The first folder that is not read-only becomes the project's working directory.",
    }),
    icon: Type.Optional(iconSchema),
    accentColor: Type.Optional(accentColorSchema),
  });
  const createTool = defineTool({
    name: UI_PROJECT_CREATE_TOOL_NAME,
    label: "Create Project",
    description:
      "Create a Pine project from folders on disk, optionally with an icon and accent color. Pine asks the user to confirm.",
    promptSnippet: `Use ${UI_PROJECT_CREATE_TOOL_NAME}, ${UI_PROJECT_UPDATE_TOOL_NAME} or ${UI_PROJECT_DELETE_TOOL_NAME} when the user asks to create, change or delete a Pine project, including its icon and accent color`,
    promptGuidelines: [
      "Pine asks the user to confirm every project change; call the tool directly instead of asking in plain text first.",
      `You can set a project's icon and accent color yourself with these tools; do not send the user to Edit Project for that. When the user asks you to choose, pick an icon that fits the project's purpose and an accent color that differs from the other projects (see ${UI_PROJECT_LIST_TOOL_NAME}). Otherwise leave them out when creating a project.`,
    ],
    parameters: createParams,
    prepareArguments: (args) => args as Static<typeof createParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const name = params.name.trim();
      if (!name) throw new Error("The project needs a name.");
      const folders = agentFolders(params.folders);
      const icon = checkedIcon(params.icon);
      const accentColor = checkedAccentColor(params.accentColor);
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_PROJECT_CREATE_TOOL_NAME,
        subject: `Create project “${name}”`,
        description: "Create a project",
        evidence: [
          `Folders:\n${folders.map(folderLine).join("\n")}`,
          icon ? `Icon: ${icon}` : "",
          accentColor
            ? `Accent color: ${ACCENT_COLOR_LABELS[accentColor]}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        signal,
      });
      if (decision.kind !== "allow")
        return declined(decision, "create the project");
      if (signal?.aborted) throw new Error("aborted");
      const result = await callProjectHost(context, {
        op: "create",
        name,
        folders,
        ...(icon ? { projectIcon: icon } : {}),
        ...(accentColor ? { projectColorTheme: accentColor } : {}),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Created project ${result.projectName} (id: ${result.projectId}).`,
          },
        ],
        details: { done: true, ...result },
      };
    },
  });

  const updateParams = Type.Object({
    projectId: Type.String(),
    name: Type.Optional(Type.String()),
    addFolders: Type.Optional(Type.Array(folderSchema)),
    removeFolders: Type.Optional(
      Type.Array(Type.String(), { description: "Paths of folders to remove." }),
    ),
    defaultFolder: Type.Optional(
      Type.String({
        description:
          "Path of the folder to use as the working directory; it must not be read-only.",
      }),
    ),
    icon: Type.Optional(iconSchema),
    accentColor: Type.Optional(accentColorSchema),
  });
  const updateTool = defineTool({
    name: UI_PROJECT_UPDATE_TOOL_NAME,
    label: "Edit Project",
    description:
      "Rename a Pine project, change its folders, or change its icon or accent color. Pine asks the user to confirm. Changing folders or the name restarts the project's sessions, so for this session's own project those changes apply after this reply ends; an icon or accent color change alone applies at once without restarting anything.",
    parameters: updateParams,
    prepareArguments: (args) => args as Static<typeof updateParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const project = await findProject(context, params.projectId.trim());
      const name = params.name?.trim() || undefined;
      const addFolders = agentFolders(params.addFolders ?? []);
      const removeFolderPaths = (params.removeFolders ?? [])
        .map((folder) => folder.trim())
        .filter(Boolean);
      const defaultFolderPath = params.defaultFolder?.trim() || undefined;
      const requestedIcon = checkedIcon(params.icon);
      const requestedAccent = checkedAccentColor(params.accentColor);
      const icon =
        requestedIcon && requestedIcon !== project.icon
          ? requestedIcon
          : undefined;
      const accentColor =
        requestedAccent && requestedAccent !== project.accentColor
          ? requestedAccent
          : undefined;
      const changes = [
        name && name !== project.name ? `Name: ${project.name} → ${name}` : "",
        ...addFolders.map((folder) => `Add ${folderLine(folder)}`),
        ...removeFolderPaths.map((folder) => `Remove ${folder}`),
        defaultFolderPath ? `Working directory: ${defaultFolderPath}` : "",
        icon ? `Icon: ${project.icon} → ${icon}` : "",
        accentColor
          ? `Accent color: ${ACCENT_COLOR_LABELS[project.accentColor]} → ${ACCENT_COLOR_LABELS[accentColor]}`
          : "",
      ].filter(Boolean);
      if (!changes.length) throw new Error("Nothing to change.");
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_PROJECT_UPDATE_TOOL_NAME,
        subject: `Edit project “${project.name}”`,
        description: "Edit a project",
        evidence: changes.join("\n"),
        signal,
      });
      if (decision.kind !== "allow")
        return declined(decision, "change the project");
      if (signal?.aborted) throw new Error("aborted");
      const result = await callProjectHost(context, {
        op: "update",
        projectId: project.id,
        ...(name ? { name } : {}),
        ...(addFolders.length ? { addFolders } : {}),
        ...(removeFolderPaths.length ? { removeFolderPaths } : {}),
        ...(defaultFolderPath ? { defaultFolderPath } : {}),
        ...(icon ? { projectIcon: icon } : {}),
        ...(accentColor ? { projectColorTheme: accentColor } : {}),
      });
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.applied === "now"
                ? `Saved project ${result.projectName}.`
                : `Project ${result.projectName} will be saved when this reply ends, which restarts this session; finish the reply briefly.`,
          },
        ],
        details: { done: true, ...result },
      };
    },
  });

  const deleteParams = Type.Object({ projectId: Type.String() });
  const deleteTool = defineTool({
    name: UI_PROJECT_DELETE_TOOL_NAME,
    label: "Delete Project",
    description:
      "Delete a Pine project and all of its sessions permanently. Its folders on disk are kept. Pine asks the user to confirm. This session's own project cannot be deleted.",
    parameters: deleteParams,
    prepareArguments: (args) => args as Static<typeof deleteParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const project = await findProject(context, params.projectId.trim());
      if (project.current)
        throw new Error("A session cannot delete the project it runs in.");
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_PROJECT_DELETE_TOOL_NAME,
        subject: `Delete project “${project.name}” permanently`,
        description: "Delete a project",
        evidence: [
          "All of its sessions are deleted. Its folders stay on disk:",
          ...project.folders.map((folder) => folder.path),
        ].join("\n"),
        signal,
      });
      if (decision.kind !== "allow")
        return declined(decision, "delete the project");
      if (signal?.aborted) throw new Error("aborted");
      const result = await callProjectHost(context, {
        op: "delete",
        projectId: project.id,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted project ${result.projectName}.`,
          },
        ],
        details: { done: true, ...result },
      };
    },
  });

  return [createTool, updateTool, deleteTool] as ToolDefinition[];
}
