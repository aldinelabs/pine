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
  });
  const createTool = defineTool({
    name: UI_PROJECT_CREATE_TOOL_NAME,
    label: "Create Project",
    description:
      "Create a Pine project from folders on disk. Pine asks the user to confirm.",
    promptSnippet: `Use ${UI_PROJECT_CREATE_TOOL_NAME}, ${UI_PROJECT_UPDATE_TOOL_NAME} or ${UI_PROJECT_DELETE_TOOL_NAME} when the user asks to create, change or delete a Pine project`,
    promptGuidelines: [
      "Pine asks the user to confirm every project change; call the tool directly instead of asking in plain text first.",
    ],
    parameters: createParams,
    prepareArguments: (args) => args as Static<typeof createParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const name = params.name.trim();
      if (!name) throw new Error("The project needs a name.");
      const folders = agentFolders(params.folders);
      const decision = await context.requestApproval({
        toolCallId,
        toolName: UI_PROJECT_CREATE_TOOL_NAME,
        subject: `Create project “${name}”`,
        description: "Create a project",
        evidence: `Folders:\n${folders.map(folderLine).join("\n")}`,
        signal,
      });
      if (decision.kind !== "allow")
        return declined(decision, "create the project");
      if (signal?.aborted) throw new Error("aborted");
      const result = await callProjectHost(context, {
        op: "create",
        name,
        folders,
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
  });
  const updateTool = defineTool({
    name: UI_PROJECT_UPDATE_TOOL_NAME,
    label: "Edit Project",
    description:
      "Rename a Pine project or change its folders. Pine asks the user to confirm. Saving restarts the project's sessions, so for this session's own project the change applies after this reply ends.",
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
      const changes = [
        name && name !== project.name ? `Name: ${project.name} → ${name}` : "",
        ...addFolders.map((folder) => `Add ${folderLine(folder)}`),
        ...removeFolderPaths.map((folder) => `Remove ${folder}`),
        defaultFolderPath ? `Working directory: ${defaultFolderPath}` : "",
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
