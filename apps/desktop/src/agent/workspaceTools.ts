import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";
import {
  UI_LIST_PROJECT_TOOL_NAME,
  UI_TELEPORT_TOOL_NAME,
} from "../shared/agent";
import type {
  AgentHostProject,
  AgentHostRequest,
  AgentHostResponse,
} from "./protocol";

export interface PineWorkspaceToolContext {
  /** Ask main, which owns the project library and session storage. */
  requestHost(request: AgentHostRequest): Promise<AgentHostResponse>;
  /** Always shown to the user, whatever the approval mode. */
  requestQuestionnaire(
    toolCallId: string,
    params: AskUserQuestionParams,
    signal?: AbortSignal,
  ): Promise<AskUserQuestionSubmission>;
  getLocale(): "en-US" | "zh-CN";
}

function describeProject(project: AgentHostProject): string {
  const folders = project.folders
    .map(
      (folder) =>
        `  - ${folder.name}: ${folder.path} (${folder.access}${
          folder.path === project.defaultFolderPath ? ", working directory" : ""
        })`,
    )
    .join("\n");
  return `- ${project.name} (id: ${project.id})\n${folders}`;
}

async function listProjects(
  context: PineWorkspaceToolContext,
): Promise<AgentHostProject[]> {
  const response = await context.requestHost({ kind: "list-projects" });
  if (response.kind !== "list-projects")
    throw new Error("Pine returned an unexpected project list.");
  return response.projects;
}

function confirmationQuestion(
  project: AgentHostProject,
  locale: "en-US" | "zh-CN",
): AskUserQuestionParams {
  const zh = locale === "zh-CN";
  return {
    questions: [
      {
        header: zh ? "移动会话" : "Move session",
        question: zh
          ? `要把这个会话移动到项目“${project.name}”吗？之后的回复会在 ${project.defaultFolderPath} 中进行，并使用该项目的文件夹权限。`
          : `Move this session to the project "${project.name}"? Later replies will work in ${project.defaultFolderPath} with that project's folder access.`,
        options: [
          {
            label: zh ? "移动" : "Move",
            description: zh
              ? "本次回复结束后，会话转到该项目中继续。"
              : "The session continues in that project once this reply ends.",
          },
          {
            label: zh ? "保持无项目" : "Keep it here",
            description: zh
              ? "会话继续不属于任何项目。"
              : "The session stays outside any project.",
          },
        ],
      },
    ],
  };
}

/**
 * Tools that only sessions of the temporary workspace get: listing the
 * user's projects and moving the session into one of them. Moving always
 * asks the user first, even in modes that otherwise run without approval.
 */
export function createWorkspaceToolDefinitions(
  context: PineWorkspaceToolContext,
): ToolDefinition[] {
  const listTool = defineTool({
    name: UI_LIST_PROJECT_TOOL_NAME,
    label: "List Projects",
    description:
      "List the user's Pine projects with their names, ids, and folder paths. This session runs in Pine's temporary workspace, which belongs to no project.",
    promptSnippet: `Use ${UI_LIST_PROJECT_TOOL_NAME} to see the user's Pine projects when the work turns out to belong to one`,
    parameters: Type.Object({}),
    execute: async () => {
      const projects = await listProjects(context);
      return {
        content: [
          {
            type: "text" as const,
            text: projects.length
              ? projects.map(describeProject).join("\n")
              : "The user has no Pine projects yet.",
          },
        ],
        details: { projects },
      };
    },
  });

  const teleportParams = Type.Object({
    projectId: Type.String({
      description: `Id of the destination project, from ${UI_LIST_PROJECT_TOOL_NAME}.`,
    }),
  });
  const teleportTool = defineTool({
    name: UI_TELEPORT_TOOL_NAME,
    label: "Move Session to Project",
    description:
      "Move this session from the temporary workspace into one of the user's projects. Pine asks the user to confirm first. When confirmed, the move happens after the current reply ends; later turns run in the project's working directory with its folder access.",
    promptSnippet: `Use ${UI_TELEPORT_TOOL_NAME} when work started in the temporary workspace belongs in one of the user's projects`,
    promptGuidelines: [
      `Call ${UI_LIST_PROJECT_TOOL_NAME} first and pass the chosen project's id.`,
      `The user is always asked to confirm. If they decline, keep working in the temporary workspace.`,
      `After a confirmed move, finish the reply briefly: the new folders are only available from the next turn.`,
    ],
    parameters: teleportParams,
    prepareArguments: (args) => args as Static<typeof teleportParams>,
    execute: async (toolCallId, params, signal) => {
      const projects = await listProjects(context);
      const project = projects.find(
        (candidate) => candidate.id === params.projectId.trim(),
      );
      if (!project) {
        throw new Error(
          `No project has id ${params.projectId}. Call ${UI_LIST_PROJECT_TOOL_NAME} for the current list.`,
        );
      }

      const submission = await context.requestQuestionnaire(
        toolCallId,
        confirmationQuestion(project, context.getLocale()),
        signal,
      );
      const choice = submission.answers[0];
      const confirmed =
        !submission.cancelled &&
        choice?.selectedOptionIndexes.length === 1 &&
        choice.selectedOptionIndexes[0] === 0;
      if (!confirmed) {
        const note = choice?.customAnswer?.trim();
        return {
          content: [
            {
              type: "text" as const,
              text: `The user did not move the session to ${project.name}; it stays in the temporary workspace.${note ? ` The user said: ${note}` : ""}`,
            },
          ],
          details: { moved: false, projectId: project.id },
        };
      }

      if (signal?.aborted) throw new Error("aborted");
      const response = await context.requestHost({
        kind: "teleport",
        projectId: project.id,
      });
      if (response.kind !== "teleport")
        throw new Error("Pine could not schedule the move.");
      return {
        content: [
          {
            type: "text" as const,
            text: `The user confirmed. This session moves to ${response.projectName} when this reply ends; from the next turn the working directory is ${response.cwd}. Finish this reply without starting new work in the temporary workspace.`,
          },
        ],
        details: { moved: true, projectId: project.id },
      };
    },
  });

  return [listTool, teleportTool] as ToolDefinition[];
}
